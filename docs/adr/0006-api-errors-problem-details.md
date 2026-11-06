# ADR 0006 — API errors use Problem Details with stable codes

- **Status:** Accepted
- **Date:** 2026-11-03
- **Deciders:** Luis
- **Amended:** 2026-11-03 (bait site slice: added BAIT_SITE_NOT_FOUND; OUT_OF_RANGE also covers timestamps)
- **Amended:** 2026-11-03 (bait site events slice: added BAIT_SITE_EVENT_NOT_FOUND and INVALID_EVENT_SEQUENCE; OUT_OF_RANGE wording now "outside its allowed window", same meaning)
- **Amended:** 2026-11-06 (bait site events slice B1: added field code NOT_ALLOWED; INVALID_EVENT_SEQUENCE also covers an IDENTIFIED whose capture is not in the history)
- **Amended:** 2026-11-06 (bait site events slice B2: INVALID_EVENT_SEQUENCE also covers a void; voiding is idempotent)

## Context

The first endpoints that validate input (projects, then bait sites and events) need an
error format before they are written, or every endpoint invents its own and the client
has to parse each one differently.

An error response has two readers:

- **The client code**, above all the offline sync queue. It runs without a person
  watching and must decide on its own whether to retry, give up, or confirm with a
  `GET`. It needs something stable to compare against.
- **The person in the field**, who needs a message in Portuguese. By convention
  (`CONVENTIONS.md`) the API speaks English, so API text is never shown to users: the
  frontend translates from a code.

Other constraints:

- Offline clients may run an old app version for weeks, so the error contract must not
  change shape when new errors are added.
- Error bodies are public. Anything internal that leaks (stack traces, SQL, constraint
  names, class names) helps an attacker and couples clients to implementation details.
- Spring Framework 6+ supports RFC 9457 natively (`ProblemDetail`,
  `ResponseEntityExceptionHandler`), and framework errors (bad JSON, wrong method) can
  use the same format.
- Less than 2 hours per week of development time.

## Options considered

### Body format

1. **A custom format**, e.g. `{ "error": { "code", "message" } }`. Simple, but a contract
   we invent and maintain alone; framework errors would need translating into it anyway.
2. **Problem Details (RFC 9457, successor of RFC 7807)**, media type
   `application/problem+json`, with `type`, `title`, `status`, `detail`, `instance` and
   extension members. A standard, supported by Spring and by HTTP client libraries.
   Chosen.

### What the client compares against

1. **`type` as the identifier**, as the RFC intends (an absolute URI per problem type).
   We have no domain, and a made-up URI would pretend a stability we do not have.
   Rejected for now.
2. **An extension member `code`** (e.g. `PROJECT_NOT_FOUND`), with `type` left as
   `about:blank`. Chosen. When there is a domain, `type` can become a documentation URI
   without breaking any client, because no client compares on `type`.

### Validation error codes

1. **Bean Validation constraint names** (`NotBlank`, `Size`). Ties the API contract to
   Java annotations; changing how validation is implemented would break clients.
   Rejected.
2. **Our own small set of field codes.** Chosen.

### Invalid event sequence (amendment, events slice)

An event that would make a bait site's history invalid under the state machine
(ADR 0005) depends on server state, not on a field, so it is not a validation error.

1. **400 `VALIDATION_FAILED` with a field error on `type`.** Rejected: the field is not
   wrong on its own, and the same request can be valid on another bait site.
2. **422 Unprocessable Content.** Acceptable semantically, but one more status for
   clients to handle with no extra information over `code`. Rejected.
3. **409 Conflict with its own `code`.** "Conflicts with the current state of the
   resource" is what happens. Chosen. Clients already branch on `code` within `4xx`, so
   sharing 409 with `ID_ALREADY_EXISTS` costs nothing.

### Field sent where it does not apply (amendment, events slice B1)

Some fields belong to some event types only (e.g. `speciesId` on `CAPTURED` and
`IDENTIFIED`). A client may send one on a type that does not take it, e.g. a species on
an `INSPECTED` event.

1. **Ignore it.** Matches how unknown JSON fields are treated, but the value the person
   chose in the field is dropped and the client is told the event was stored as sent.
   Rejected.
2. **`INVALID_FORMAT`.** Avoids a new code, but the value is not malformed; the field
   should not be there at all. The case is permanent, so the misleading code would be
   permanent too. Rejected.
3. **A new field code `NOT_ALLOWED`.** Says exactly what is wrong; one more value in a
   small set. Chosen.

## Decision

**Every error response from the API is a Problem Details document
(`application/problem+json`) with an extra member `code`, the stable contract for
clients.** One exception: authentication failures (401), see below.

### Response shape

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "Request validation failed.",
  "instance": "/api/projects",
  "code": "VALIDATION_FAILED",
  "errors": [
    { "field": "name", "code": "TOO_LONG" },
    { "field": "id", "code": "INVALID_FORMAT" }
  ]
}
```

- `code` is always present on error responses (except 401). It is upper snake case and,
  once published, is never renamed or reused for a different meaning.
- `title` is the HTTP reason phrase. `detail` is a short English sentence written by us
  for developers. Neither is shown to users.
- `errors` appears only with `VALIDATION_FAILED`.

### How clients use it

- The HTTP status decides first. `5xx` or a network failure: retry later. `4xx`:
  retrying the same request will not help.
- Within `4xx`, `code` decides the action. For example, `ID_ALREADY_EXISTS` on a create
  means "confirm with a `GET`" (ADR 0002: client-generated ids, the server never
  upserts).
- `INVALID_EVENT_SEQUENCE` means the event was not stored because it does not fit the
  bait site's current history. Resending it unchanged will not help while the history
  stays the same; how the client resolves it belongs to the sync strategy.
- **A resend of an event that is already stored always gets `ID_ALREADY_EXISTS`, never
  `INVALID_EVENT_SEQUENCE`**, so a client whose response was lost can confirm with a
  `GET` instead of concluding that the event failed.
- For an `IDENTIFIED` event, `INVALID_EVENT_SEQUENCE` also means the capture it points
  to is not in the bait site's history as a non-voided `CAPTURED` that occurred before
  it. A capture the server does not have yet (rejected, or still unsynced on another
  device) is reported the same way: the identification may become valid later.
- For a void, `INVALID_EVENT_SEQUENCE` means the event was not voided because later
  events depend on it (e.g. an `IDENTIFIED` pointing to the capture). Void those first,
  one at a time, then retry.
- **Voiding is idempotent**: voiding an event that is already voided returns `200` with
  the event as stored (the original `voidedAt` is kept). Unlike a create, a resend after
  a lost response needs no `GET`: the request only asks for the event to be voided, and
  it is.
- The UI maps `code` (and field codes) to Portuguese text.

### Problem codes

| Situation | Status | `code` |
|---|---|---|
| Unreadable JSON, wrong JSON type, malformed path parameter | 400 | `MALFORMED_REQUEST` |
| One or more invalid fields | 400 | `VALIDATION_FAILED` (+ `errors`) |
| Authenticated, but lacks the required role in the project | 403 | `FORBIDDEN` |
| Project does not exist **or** the caller is not a member (identical response) | 404 | `PROJECT_NOT_FOUND` |
| Bait site does not exist in this project, or exists in another project (identical response) | 404 | `BAIT_SITE_NOT_FOUND` |
| Event does not exist on this bait site, or exists on another bait site or project (identical response) | 404 | `BAIT_SITE_EVENT_NOT_FOUND` |
| No endpoint at this path | 404 | `RESOURCE_NOT_FOUND` |
| Wrong HTTP method | 405 | `METHOD_NOT_ALLOWED` |
| Create with an id that already exists | 409 | `ID_ALREADY_EXISTS` |
| The event, or voiding an event, would make the bait site's history invalid under the state machine (ADR 0005), including when it is valid at its own position but breaks a later event, and an `IDENTIFIED` whose capture is not in the history | 409 | `INVALID_EVENT_SEQUENCE` |
| Wrong `Content-Type` | 415 | `UNSUPPORTED_MEDIA_TYPE` |
| Any other client error raised by the framework | its status | `INVALID_REQUEST` |
| Anything else | 500 | `INTERNAL_ERROR` |

New codes are added by updating this table (amending this ADR or in the ADR that
introduces the feature).

### Field codes (inside `errors`)

| Field code | Meaning |
|---|---|
| `REQUIRED` | Missing, null, or blank after trimming |
| `TOO_LONG` | Longer than the maximum length |
| `INVALID_FORMAT` | Wrong format or not one of the accepted values (e.g. not a canonical UUID v7, an unknown event type, a species that does not exist) |
| `OUT_OF_RANGE` | Value outside its allowed window (e.g. latitude, a timestamp too far in the future or too far in the past) |
| `NOT_ALLOWED` | Sent where this field does not apply (e.g. `speciesId` on an `INSPECTED` event) |

- `field` is the name of the field **in the JSON body**, not the Java field name.
- All invalid fields are reported in one response, not only the first.
- A field counts as sent when it is present with a non-null value; `null` is the same as absent.

### Authentication failures (401)

401 responses keep Spring Security's default: empty body, reason in the
`WWW-Authenticate` header (RFC 6750). They are produced in the security filter chain,
before the MVC layer, and for the client a 401 has a single action (refresh the token or
sign in again), so it needs no `code`.

## Consequences

### Positive

- One format for every error, including framework errors; one parser in the client.
- The sync queue can decide retry / give up / confirm without parsing text.
- New errors are new `code` values; the shape never changes, so old offline clients keep
  working.
- Translation lives entirely in the frontend; API text stays in English.
- Bodies never carry internal details, by rule rather than by care.

### Negative

- `type` carries no information until there is a domain; clients must use `code`.
- A central handler must map every exception, and framework errors must have their
  default `detail` replaced (Spring's default text can echo request input).
- A database constraint violation that escapes application validation becomes a 500,
  not a helpful 400. Accepted: it means the API failed to validate, which is a bug to
  fix, and mapping it automatically would leak constraint names or misstate the cause.
- 401 is the one error without a Problem Details body.
- `INVALID_EVENT_SEQUENCE` carries no detail (which event broke, current status), so the
  UI can only show a generic message. Adding an extension member later is an amendment
  that does not break clients.

### Derived rules (non-negotiable)

1. **No internals in error bodies.** Never include stack traces, exception messages,
   class names, SQL, constraint or table names, file paths, tokens or headers. `detail`
   is always a fixed sentence we wrote, never `exception.getMessage()` and never
   Spring's default `detail`.
2. **Unhandled exceptions** become `500 INTERNAL_ERROR` with a generic `detail`, and
   are logged server-side at `ERROR` with the stack trace.
3. **Escaped constraint violations are 500**, not 400 or 409. Expected conflicts are
   handled explicitly in code (e.g. `INSERT ... ON CONFLICT DO NOTHING` and checking the
   row count), never by catching a database error.
4. **A single exception handler** (`@RestControllerAdvice` extending
   `ResponseEntityExceptionHandler`) builds every error response. Domain exceptions live
   in their feature packages and carry their `code`; the handler only translates.
5. **Non-members get exactly the same 404 as a missing project** (ADR 0001 access
   check), so responses never confirm that a project exists.
6. **API text is English; users never see it.** The UI maps codes to Portuguese.
