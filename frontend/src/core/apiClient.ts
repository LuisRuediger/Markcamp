import {
  NetworkError,
  type ApiTransport,
  type AuthPort,
  type HttpMethod,
  type TransportResponse,
} from './ports'

export interface ApiRequest {
  readonly method: HttpMethod
  readonly path: string
  readonly body?: unknown
}

export type ApiResult =
  | { readonly kind: 'ok'; readonly status: number; readonly body: unknown }
  | { readonly kind: 'apiError'; readonly status: number; readonly code: string | null }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'unavailable' }

export interface ApiClient {
  request(request: ApiRequest): Promise<ApiResult>
  /** The handler runs when the API rejects a freshly refreshed token. */
  setUnauthorizedHandler(handler: () => void): void
}

function problemCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) return null
  return typeof body.code === 'string' ? body.code : null
}

export function createApiClient(
  auth: Pick<AuthPort, 'getIdToken'>,
  transport: ApiTransport,
): ApiClient {
  let unauthorizedHandler: () => void = () => {}

  // null means "could not reach the API". No token right now is not "signed out"
  // (ADR 0004, rule 7): offline with an expired token ends here and keeps the session.
  async function send(request: ApiRequest, forceRefresh: boolean): Promise<TransportResponse | null> {
    let token: string
    try {
      token = await auth.getIdToken(forceRefresh)
    } catch {
      return null
    }
    try {
      return await transport.send({ ...request, token })
    } catch (error) {
      if (error instanceof NetworkError) return null
      throw error // A programming error, such as an invalid path.
    }
  }

  return {
    async request(request) {
      let response = await send(request, false)
      if (response === null) return { kind: 'unavailable' }

      if (response.status === 401) {
        response = await send(request, true)
        if (response === null) return { kind: 'unavailable' }
        if (response.status === 401) {
          unauthorizedHandler()
          return { kind: 'unauthorized' }
        }
      }

      if (response.status >= 200 && response.status < 300) {
        return { kind: 'ok', status: response.status, body: response.body }
      }
      // Only status and code leave here: title and detail are never for the UI (ADR 0006).
      return { kind: 'apiError', status: response.status, code: problemCode(response.body) }
    },
    setUnauthorizedHandler(handler) {
      unauthorizedHandler = handler
    },
  }
}
