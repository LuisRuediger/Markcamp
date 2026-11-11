import type { ApiClient } from './apiClient'
import { SignInError, type AuthPort, type AuthUser, type Logger, type SignInErrorKind } from './ports'

export type BackendState = 'checking' | 'ok' | 'unavailable'
export type SessionNotice = 'sessionExpired'

export type SessionSnapshot =
  | { readonly status: 'loading' }
  | { readonly status: 'signedOut'; readonly notice: SessionNotice | null }
  | { readonly status: 'signedIn'; readonly email: string | null; readonly backend: BackendState }

/** A popup closed by the person is not an error for them, so it never reaches the screen. */
export type SignInFailureKind = Exclude<SignInErrorKind, 'popupClosed'>

/** What the UI depends on, so tests can pass a fake. */
export interface SessionStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): SessionSnapshot
  signInWithEmail(email: string, password: string): Promise<SignInFailureKind | null>
  signInWithGoogle(): Promise<SignInFailureKind | null>
  signOut(): Promise<void>
}

/** What other core stores need to follow the session, without seeing who is signed in. */
export interface SessionKeySource {
  subscribe(listener: () => void): () => void
  /** null when not signed in; a different value for every new session, including a direct account switch. */
  getSessionKey(): number | null
}

/**
 * Who is signed in, for the local session only (ADR 0008, decision 9). The uid never reaches
 * a screen (SessionSnapshot does not carry it), a log or an error message.
 */
export interface SessionIdentity {
  readonly uid: string
  /** From GET /me; null until it answered ok in this session. */
  readonly userId: string | null
  readonly backend: BackendState
}

export interface SessionIdentitySource extends SessionKeySource {
  /** null when not signed in. The same object while nothing changed. */
  getIdentity(): SessionIdentity | null
  /** Runs GET /me again when signed in with backend 'unavailable'; a no-op otherwise. */
  retryBackendCheck(): void
}

export function createSessionStore(
  auth: AuthPort,
  api: ApiClient,
  logger: Logger,
): SessionStore & SessionIdentitySource {
  let snapshot: SessionSnapshot = { status: 'loading' }
  // Memory only. The uid is handed to the local session for the device's mapping database
  // and nowhere else; userId names the local database (ADR 0008, decision 9).
  let uid: string | null = null
  let userId: string | null = null
  let identity: SessionIdentity | null = null
  // Bumped on every session change, so a late /me answer cannot touch a newer session.
  let generation = 0
  const listeners = new Set<() => void>()

  function setSnapshot(next: SessionSnapshot): void {
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  function setBackend(backend: BackendState): void {
    if (snapshot.status === 'signedIn') setSnapshot({ ...snapshot, backend })
  }

  async function checkBackend(checkGeneration: number): Promise<void> {
    const result = await api.request({ method: 'GET', path: '/me' })
    if (checkGeneration !== generation) return

    switch (result.kind) {
      case 'ok': {
        const body = result.body
        if (typeof body === 'object' && body !== null && 'id' in body && typeof body.id === 'string') {
          userId = body.id
          setBackend('ok')
        } else {
          logger.error('GET /me returned a body without a string id.')
          setBackend('unavailable')
        }
        return
      }
      case 'apiError':
      case 'unavailable':
        setBackend('unavailable')
        return
      case 'unauthorized':
        return // Already handled by the unauthorized handler, for every API call.
    }
  }

  function handleUserChanged(user: AuthUser | null): void {
    generation += 1
    uid = user?.uid ?? null
    userId = null
    if (user === null) {
      // Already signedOut keeps the same snapshot, and so the sessionExpired notice.
      if (snapshot.status !== 'signedOut') setSnapshot({ status: 'signedOut', notice: null })
      return
    }
    setSnapshot({ status: 'signedIn', email: user.email, backend: 'checking' })
    void checkBackend(generation)
  }

  async function handleUnauthorized(): Promise<void> {
    if (snapshot.status !== 'signedIn') return
    generation += 1
    uid = null
    userId = null
    setSnapshot({ status: 'signedOut', notice: 'sessionExpired' })
    try {
      await auth.signOut()
    } catch {
      logger.error('Sign-out after session expiry failed.')
    }
  }

  async function attemptSignIn(attempt: () => Promise<void>): Promise<SignInFailureKind | null> {
    if (snapshot.status === 'signedOut' && snapshot.notice !== null) {
      setSnapshot({ status: 'signedOut', notice: null })
    }
    try {
      await attempt()
      return null
    } catch (error) {
      if (!(error instanceof SignInError)) {
        logger.error('Sign-in failed with an unexpected error type.')
        return 'unknown'
      }
      return error.kind === 'popupClosed' ? null : error.kind
    }
  }

  api.setUnauthorizedHandler(() => void handleUnauthorized())
  auth.onUserChanged(handleUserChanged)

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    // generation is bumped before every session change is published, so listeners already see the new key.
    getSessionKey: () => (snapshot.status === 'signedIn' ? generation : null),
    getIdentity() {
      if (snapshot.status !== 'signedIn' || uid === null) return null
      const { backend } = snapshot
      // A new object only when a field changed, so callers can compare with ===.
      if (identity === null || identity.uid !== uid || identity.userId !== userId || identity.backend !== backend) {
        identity = { uid, userId, backend }
      }
      return identity
    },
    retryBackendCheck() {
      if (snapshot.status !== 'signedIn' || snapshot.backend !== 'unavailable') return
      setBackend('checking')
      // The current generation: an answer that arrives after a sign-out is ignored by checkBackend.
      void checkBackend(generation)
    },
    signInWithEmail: (email, password) => attemptSignIn(() => auth.signInWithEmail(email, password)),
    signInWithGoogle: () => attemptSignIn(() => auth.signInWithGoogle()),
    async signOut() {
      try {
        await auth.signOut()
      } catch {
        logger.error('Sign-out failed.')
      }
    },
  }
}
