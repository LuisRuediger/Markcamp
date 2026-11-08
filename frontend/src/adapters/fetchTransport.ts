import { NetworkError, type ApiTransport } from '../core/ports'

const JSON_CONTENT_TYPE = /^application\/([a-z0-9.+-]+\+)?json\s*(;|$)/i

// The bearer token goes only to the API base (ADR 0007, rule 5). That holds by construction
// as long as a caller cannot turn the path into another origin.
function assertRelativePath(path: string): void {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error('API path must start with exactly one slash.')
  }
}

async function readBody(response: Response): Promise<unknown> {
  if (!JSON_CONTENT_TYPE.test(response.headers.get('Content-Type') ?? '')) return null
  try {
    return await response.json()
  } catch {
    return null
  }
}

export function createFetchTransport(apiBase: string, fetchFn: typeof fetch = fetch): ApiTransport {
  return {
    async send({ method, path, body, token }) {
      assertRelativePath(path)

      const headers: Record<string, string> = {
        Accept: 'application/json, application/problem+json',
      }
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`

      const init: RequestInit = { method, headers }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }

      let response: Response
      try {
        response = await fetchFn(apiBase + path, init)
      } catch {
        // A new error, with nothing from the original: its message could echo a header value.
        throw new NetworkError()
      }
      return { status: response.status, body: await readBody(response) }
    },
  }
}
