// Ports (ADR 0007): interfaces declared by core and implemented in src/adapters/.
// The local database port (LocalStore) and its types live in localStore.ts.

export interface AuthUser {
  readonly email: string | null
}

export type SignInErrorKind =
  | 'invalidCredentials'
  | 'invalidEmail'
  | 'tooManyAttempts'
  | 'popupClosed'
  | 'popupBlocked'
  | 'network'
  | 'unknown'

export class SignInError extends Error {
  readonly kind: SignInErrorKind

  constructor(kind: SignInErrorKind) {
    super(`Sign-in failed: ${kind}`)
    this.name = 'SignInError'
    this.kind = kind
  }
}

export interface AuthPort {
  /** Called once after the session is restored, then on every change. */
  onUserChanged(listener: (user: AuthUser | null) => void): () => void
  /** Rejects with SignInError. */
  signInWithEmail(email: string, password: string): Promise<void>
  /** Rejects with SignInError. */
  signInWithGoogle(): Promise<void>
  signOut(): Promise<void>
  /** Rejects if there is no user or no token can be obtained (e.g. offline and expired). */
  getIdToken(forceRefresh: boolean): Promise<string>
}

/** One string only, so an object (a body, a user, an error) cannot be logged by accident. */
export interface Logger {
  error(message: string): void
  warn(message: string): void
}

/** Implemented in adapters: core may not import npm packages nor use crypto (ADR 0007). */
export interface IdGenerator {
  /** A new UUID v7 in canonical lowercase form (ADR 0002). */
  newId(): string
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface TransportRequest {
  readonly method: HttpMethod
  /** Relative to the API base, e.g. /me. The transport owns the base URL (ADR 0007, rule 5). */
  readonly path: string
  readonly body?: unknown
  readonly token?: string
}

export interface TransportResponse {
  readonly status: number
  readonly body: unknown
}

/** Rejection reason of ApiTransport.send when there is no response. */
export class NetworkError extends Error {
  constructor() {
    super('Network request failed.')
    this.name = 'NetworkError'
  }
}

export interface ApiTransport {
  /** Rejects with NetworkError when there is no response. */
  send(request: TransportRequest): Promise<TransportResponse>
}
