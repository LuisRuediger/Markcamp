// Ports (ADR 0007): interfaces declared by core and implemented in src/adapters/.
// The local database port (LocalStore) and its types live in localStore.ts.

export interface AuthUser {
  /**
   * The provider's id of the user. Only for the uid → internal id mapping on the device
   * (ADR 0008, decision 9): never logged, never in a snapshot a screen reads.
   */
  readonly uid: string
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

/**
 * What asking the browser to keep this site's storage gave (ADR 0008, decision 11).
 * 'alreadyPersisted': it was already, nothing was asked. 'unsupported': the browser has no
 * such API, or it failed.
 */
export type PersistOutcome = 'alreadyPersisted' | 'granted' | 'denied' | 'unsupported'

export interface StoragePersistence {
  /** Never rejects: the outcome never blocks anything (ADR 0008). The caller logs it. */
  request(): Promise<PersistOutcome>
}

/** Core has no setTimeout (no DOM library, ADR 0007): the sync engine's safety timer goes through here. */
export interface Timers {
  /** Calls back once after ms. Returns a cancel function. */
  after(ms: number, callback: () => void): () => void
}

/** Browser lifecycle events the core needs (ADR 0007: core has no DOM). */
export interface AppLifecycle {
  /** window 'online': the device reports a network connection again. Returns an unsubscribe function. */
  onOnline(listener: () => void): () => void
  /** document 'visibilitychange' to 'visible'. Returns an unsubscribe function. */
  onForeground(listener: () => void): () => void
}

export interface GeoReading {
  readonly latitude: number
  readonly longitude: number
  /** Radius in metres, as reported by the device. */
  readonly accuracyM: number
}

/** denied: the user refused (no more callbacks). unavailable: no fix right now (still watching). unsupported: no geolocation on this device (no more callbacks). */
export type GeoFailure = 'denied' | 'unavailable' | 'unsupported'

/** The device's position (decision J3 of slice F3). Named so it never shadows the DOM's Geolocation in ui files. */
export interface GeolocationPort {
  /**
   * Starts watching. Callbacks are never called before watch() returns, and never after
   * the returned stop function is called (it is idempotent).
   */
  watch(onReading: (reading: GeoReading) => void, onFailure: (failure: GeoFailure) => void): () => void
}

export type HttpMethod ='GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

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
