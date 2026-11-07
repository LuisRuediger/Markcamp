#!/usr/bin/env bash
#
# End-to-end check of GET /api/me with a real Firebase ID token.
#
# Usage, from your own terminal (it prompts for the API key, email and password):
#   ./scripts/smoke-auth.sh
#   WRONG_PROJECT_URL=http://localhost:8081 ./scripts/smoke-auth.sh
#
# BASE_URL defaults to http://localhost:8080. WRONG_PROJECT_URL is optional: a second
# instance running with a different FIREBASE_PROJECT_ID.
#
# Secrets live only in shell variables. They are never printed or written to disk, and
# never passed as a command-line argument. printf is a shell builtin, so it starts no
# process that could show them.

set -euo pipefail
set +x # Even under "bash -x", tracing would print the secrets.

BASE_URL=${BASE_URL:-http://localhost:8080}
WRONG_PROJECT_URL=${WRONG_PROJECT_URL:-}
SIGN_IN_URL='https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'
UUID_V7='^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
BASE64URL='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

cleanup() {
	unset -v API_KEY EMAIL PASSWORD TOKEN TAMPERED_TOKEN SIGN_IN_RESPONSE
}
trap cleanup EXIT

FAILURES=0

check() { # check <label> <true|false>
	if [ "$2" = true ]; then
		printf 'PASS  %s\n' "$1"
	else
		printf 'FAIL  %s\n' "$1"
		FAILURES=$((FAILURES + 1))
	fi
}

if command -v jq >/dev/null 2>&1; then
	JSON_TOOL=jq
elif command -v python3 >/dev/null 2>&1; then
	JSON_TOOL=python3
else
	printf 'This script needs jq or python3.\n' >&2
	exit 1
fi

# Prints a string field of the JSON on stdin (e.g. ".error.message"); prints nothing if it is absent.
# Errors go to /dev/null because a parser's message can quote its input. tr: native Windows tools emit CRLF.
json_field() {
	if [ "$JSON_TOOL" = jq ]; then
		jq -r "$1 | strings" 2>/dev/null | tr -d '\r'
	else
		python3 -c '
import json, sys
value = json.load(sys.stdin)
for key in sys.argv[1].lstrip(".").split("."):
    value = value[key]
if isinstance(value, str):
    sys.stdout.write(value)
' "$1" 2>/dev/null
	fi
}

# Encodes the text on stdin as a JSON string, so a quote in a password cannot break the request body.
json_string() {
	if [ "$JSON_TOOL" = jq ]; then
		jq -Rs . | tr -d '\r'
	else
		python3 -c '
import json, sys
sys.stdout.write(json.dumps(sys.stdin.buffer.read().decode("utf-8")))
'
	fi
}

# Escapes a value for a double-quoted parameter in a curl config file. sed and not ${value//...}, because bash 3.2 (the
# macOS default) handles backslashes in that expansion differently. The value goes through stdin, not as an argument.
curl_config_value() {
	printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

read -rsp 'Firebase Web API key: ' API_KEY
printf '\n' >&2
read -rsp 'Email: ' EMAIL
printf '\n' >&2
read -rsp 'Password: ' PASSWORD
printf '\n' >&2

sign_in() {
	local email_json password_json body
	email_json=$(printf '%s' "$EMAIL" | json_string)
	password_json=$(printf '%s' "$PASSWORD" | json_string)
	body="{\"email\":$email_json,\"password\":$password_json,\"returnSecureToken\":true}"
	# The whole request goes through stdin as a curl config (-K -): the key is in the URL and the password in the
	# body, and both would show up in the process list as command-line arguments.
	printf 'url = "%s"\nheader = "Content-Type: application/json"\ndata = "%s"\n' \
		"$(curl_config_value "$SIGN_IN_URL?key=$API_KEY")" \
		"$(curl_config_value "$body")" |
		curl -sS --max-time 30 -K -
}

if ! SIGN_IN_RESPONSE=$(sign_in); then
	printf 'Sign-in failed: could not reach Firebase.\n' >&2
	exit 1
fi
unset -v API_KEY EMAIL PASSWORD

TOKEN=$(printf '%s' "$SIGN_IN_RESPONSE" | json_field .idToken) || TOKEN=''
if [ -z "$TOKEN" ]; then
	ERROR_MESSAGE=$(printf '%s' "$SIGN_IN_RESPONSE" | json_field .error.message) || ERROR_MESSAGE=''
	printf 'Sign-in failed: %s\n' "${ERROR_MESSAGE:-unexpected response from Firebase}" >&2
	exit 1
fi
unset -v SIGN_IN_RESPONSE

# Calls <base-url>/api/me, with the token if one is given, and sets STATUS and BODY. STATUS is 000 if curl cannot connect.
call_me() {
	local url=${1%/}/api/me token=${2:-} output
	if [ -n "$token" ]; then
		# Header through stdin (-H @-), not as an argument: curl's arguments are visible to anyone who can list processes.
		output=$(printf 'Authorization: Bearer %s\n' "$token" |
			curl -sS --max-time 30 -H @- -w '\n%{http_code}' "$url") || true
	else
		output=$(curl -sS --max-time 30 -w '\n%{http_code}' "$url" </dev/null) || true
	fi
	STATUS=${output##*$'\n'}
	BODY=${output%$'\n'*}
}

# 1. No token.
call_me "$BASE_URL"
if [ "$STATUS" = 401 ]; then check 'no token -> 401' true; else check 'no token -> 401' false; fi

# 2. Real token.
call_me "$BASE_URL" "$TOKEN"
USER_ID=''
if [ "$STATUS" = 200 ]; then
	USER_ID=$(printf '%s' "$BODY" | json_field .id) || USER_ID=''
fi
if [[ $USER_ID =~ $UUID_V7 ]]; then ID_IS_V7=true; else ID_IS_V7=false; USER_ID=''; fi
check 'real token -> 200, id is a UUID v7' "$ID_IS_V7"

# 3. Same token again: no second user.
call_me "$BASE_URL" "$TOKEN"
SECOND_ID=''
if [ "$STATUS" = 200 ]; then
	SECOND_ID=$(printf '%s' "$BODY" | json_field .id) || SECOND_ID=''
fi
if [ -n "$USER_ID" ] && [ "$SECOND_ID" = "$USER_ID" ]; then
	check 'same token again -> 200, same id' true
else
	check 'same token again -> 200, same id' false
fi

# 4. Tampered signature. An RS256 signature is 256 bytes, so its last base64url character holds only 2 real bits in its
# top positions; the other 4 are padding that decoders ignore. Changing only those would leave the signature valid, so
# this flips the top bit (index XOR 32), which always changes a decoded byte.
LAST_CHAR=${TOKEN: -1}
PREFIX=${BASE64URL%%"$LAST_CHAR"*}
TAMPERED_TOKEN=${TOKEN%?}${BASE64URL:$((${#PREFIX} ^ 32)):1}
call_me "$BASE_URL" "$TAMPERED_TOKEN"
if [ "$STATUS" = 401 ]; then check 'tampered token -> 401' true; else check 'tampered token -> 401' false; fi

# 5. Real token, but this instance expects another Firebase project.
if [ -n "$WRONG_PROJECT_URL" ]; then
	call_me "$WRONG_PROJECT_URL" "$TOKEN"
	if [ "$STATUS" = 401 ]; then check 'real token, wrong project -> 401' true; else check 'real token, wrong project -> 401' false; fi
fi

if [ -n "$USER_ID" ]; then
	printf 'Internal user id: %s\n' "$USER_ID"
fi

if [ "$FAILURES" -ne 0 ]; then
	exit 1
fi
