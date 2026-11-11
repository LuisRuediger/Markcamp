import { NetworkError, type ApiTransport, type TransportResponse } from '../core/ports'
import { TimeoutError, withTimeout } from './withTimeout'

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

async function exchange(fetchFn: typeof fetch, url: string, init: RequestInit): Promise<TransportResponse> {
  let response: Response
  try {
    response = await fetchFn(url, init)
  } catch {
    // A new error, with nothing from the original: its message could echo a header value.
    throw new NetworkError()
  }
  return { status: response.status, body: await readBody(response) }
}

/**
 * Every request has a limit (ADR 0008, rule 5), here because AbortController is a browser
 * API and this covers every request. It includes reading the body: a stalled download on
 * weak signal must not hang either. A timed-out request may still have reached the server;
 * its retry then gets 409 ID_ALREADY_EXISTS and confirms with a GET, by design.
 */
export function createFetchTransport(
  apiBase: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 20_000,
): ApiTransport {
  return {
    async send({ method, path, body, token }) {
      assertRelativePath(path)

      const headers: Record<string, string> = {
        Accept: 'application/json, application/problem+json',
      }
      if (token !== undefined) headers['Authorization'] = `Bearer ${token}`

      const controller = new AbortController()
      const init: RequestInit = { method, headers, signal: controller.signal }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }

      try {
        return await withTimeout(exchange(fetchFn, apiBase + path, init), timeoutMs, () => controller.abort())
      } catch (error) {
        // No answer in time is no answer: the API client turns it into 'unavailable'.
        if (error instanceof TimeoutError) throw new NetworkError()
        throw error
      }
    },
  }
}
