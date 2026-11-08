import { describe, expect, test, vi } from 'vitest'
import { createApiClient } from './apiClient'
import {
  NetworkError,
  SignInError,
  type ApiTransport,
  type AuthPort,
  type AuthUser,
  type Logger,
  type TransportResponse,
} from './ports'
import { createSessionStore } from './sessionStore'

const USER: AuthUser = { email: 'person@example.com' }
const ME_OK: TransportResponse = { status: 200, body: { id: 'user-1' } }

// Capped for the reason given in apiClient.test.ts: a runaway retry must fail, not hang.
function alwaysUnauthorized() {
  let calls = 0
  return async (): Promise<TransportResponse> => {
    calls += 1
    if (calls > 50) throw new Error('Runaway retry in the API client.')
    return { status: 401, body: null }
  }
}

function setup(answer: () => Promise<TransportResponse> = async () => ME_OK) {
  let emit: (user: AuthUser | null) => void = () => {}
  const auth = {
    onUserChanged: vi.fn<AuthPort['onUserChanged']>((listener) => {
      emit = listener
      return () => {}
    }),
    signInWithEmail: vi.fn<AuthPort['signInWithEmail']>(async () => {}),
    signInWithGoogle: vi.fn<AuthPort['signInWithGoogle']>(async () => {}),
    signOut: vi.fn<AuthPort['signOut']>(async () => {}),
    getIdToken: vi.fn<AuthPort['getIdToken']>(async () => 'token'),
  } satisfies AuthPort
  const send = vi.fn<ApiTransport['send']>(answer)
  const logger = { error: vi.fn<Logger['error']>(), warn: vi.fn<Logger['warn']>() }
  const store = createSessionStore(auth, createApiClient(auth, { send }), logger)
  return { auth, send, logger, store, emit: (user: AuthUser | null) => emit(user) }
}

/** Signs in and waits for the /me check to finish. */
async function signedIn(answer?: () => Promise<TransportResponse>) {
  const context = setup(answer)
  context.emit(USER)
  await vi.waitFor(() => {
    const snapshot = context.store.getSnapshot()
    expect(snapshot.status === 'signedIn' && snapshot.backend === 'checking').toBe(false)
  })
  return context
}

describe('session state', () => {
  test('starts in loading', () => {
    expect(setup().store.getSnapshot()).toEqual({ status: 'loading' })
  })

  test('no user moves loading to signedOut', () => {
    const { store, emit } = setup()

    emit(null)

    expect(store.getSnapshot()).toEqual({ status: 'signedOut', notice: null })
  })

  test('a user moves loading to signedIn, checking the backend', () => {
    const { store, emit } = setup()

    emit(USER)

    expect(store.getSnapshot()).toEqual({
      status: 'signedIn',
      email: USER.email,
      backend: 'checking',
    })
  })
})

describe('GET /me', () => {
  test('ok gives backend ok and keeps the id, until sign-out', async () => {
    const { store, send, emit } = await signedIn()

    expect(send).toHaveBeenCalledExactlyOnceWith({ method: 'GET', path: '/me', token: 'token' })
    expect(store.getSnapshot()).toEqual({ status: 'signedIn', email: USER.email, backend: 'ok' })
    expect(store.getUserId()).toBe('user-1')

    emit(null)

    expect(store.getUserId()).toBeNull()
  })

  test('a network failure stays signedIn with backend unavailable', async () => {
    const { store, auth } = await signedIn(async () => {
      throw new NetworkError()
    })

    expect(store.getSnapshot()).toEqual({
      status: 'signedIn',
      email: USER.email,
      backend: 'unavailable',
    })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  test('an API error stays signedIn with backend unavailable', async () => {
    const { store } = await signedIn(async () => ({ status: 500, body: { code: 'INTERNAL_ERROR' } }))

    expect(store.getSnapshot()).toEqual({
      status: 'signedIn',
      email: USER.email,
      backend: 'unavailable',
    })
  })

  test('unauthorized signs out and moves to signedOut with sessionExpired', async () => {
    const { store, auth, emit } = await signedIn(alwaysUnauthorized())

    expect(auth.signOut).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toEqual({ status: 'signedOut', notice: 'sessionExpired' })

    // Firebase then reports no user, which must not erase the notice.
    emit(null)

    expect(store.getSnapshot()).toEqual({ status: 'signedOut', notice: 'sessionExpired' })
  })

  test('a body without a string id gives unavailable and logs nothing from the body', async () => {
    const secret = 'value-from-the-response-body'
    const { store, logger } = await signedIn(async () => ({ status: 200, body: { id: 7, secret } }))

    expect(store.getSnapshot()).toEqual({
      status: 'signedIn',
      email: USER.email,
      backend: 'unavailable',
    })
    expect(store.getUserId()).toBeNull()
    expect(logger.error).toHaveBeenCalledOnce()
    expect(logger.error.mock.calls[0]![0]).not.toContain(secret)
    expect(logger.error.mock.calls[0]![0]).not.toContain('7')
  })

  test('an answer that arrives after sign-out is ignored', async () => {
    let answer: (response: TransportResponse) => void = () => {}
    const { store, send, emit } = setup(
      () => new Promise((resolve) => (answer = resolve)),
    )
    emit(USER)
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce())

    emit(null)
    const afterSignOut = store.getSnapshot()
    answer(ME_OK)
    await send.mock.results[0]!.value

    expect(store.getSnapshot()).toBe(afterSignOut)
    expect(store.getUserId()).toBeNull()
  })
})

describe('session key', () => {
  test('null while loading and signed out, non-null signed in', () => {
    const { store, emit } = setup()
    expect(store.getSessionKey()).toBeNull()

    emit(null)
    expect(store.getSessionKey()).toBeNull()

    emit(USER)
    expect(store.getSessionKey()).not.toBeNull()
  })

  test('a direct switch from one user to another changes the key', () => {
    const { store, emit } = setup()
    emit(USER)
    const first = store.getSessionKey()

    emit({ email: 'other@example.com' })

    expect(store.getSessionKey()).not.toBeNull()
    expect(store.getSessionKey()).not.toBe(first)
  })

  test('sign-out then sign-in gives a new key', () => {
    const { store, emit } = setup()
    emit(USER)
    const first = store.getSessionKey()

    emit(null)
    emit(USER)

    expect(store.getSessionKey()).not.toBeNull()
    expect(store.getSessionKey()).not.toBe(first)
  })

  test('listeners already see the new key when notified', () => {
    const { store, emit } = setup()
    const seen: (number | null)[] = []
    store.subscribe(() => seen.push(store.getSessionKey()))

    emit(USER)
    emit({ email: 'other@example.com' })

    expect(seen[0]).not.toBeNull()
    expect(seen[1]).not.toBeNull()
    expect(seen[1]).not.toBe(seen[0])
  })
})

describe('actions', () => {
  test('signInWithEmail passes the values and returns null on success', async () => {
    const { store, auth, emit } = setup()
    emit(null)

    await expect(store.signInWithEmail('a@b.c', 'pw')).resolves.toBeNull()

    expect(auth.signInWithEmail).toHaveBeenCalledExactlyOnceWith('a@b.c', 'pw')
  })

  test('a sign-in failure returns its kind', async () => {
    const { store, auth, emit } = setup()
    emit(null)
    auth.signInWithEmail.mockRejectedValue(new SignInError('invalidCredentials'))

    await expect(store.signInWithEmail('a@b.c', 'pw')).resolves.toBe('invalidCredentials')
  })

  test('a popup closed by the person returns null', async () => {
    const { store, auth, emit } = setup()
    emit(null)
    auth.signInWithGoogle.mockRejectedValue(new SignInError('popupClosed'))

    await expect(store.signInWithGoogle()).resolves.toBeNull()
  })

  test('a new sign-in clears the sessionExpired notice', async () => {
    const { store } = await signedIn(alwaysUnauthorized())

    await store.signInWithEmail('a@b.c', 'pw')

    expect(store.getSnapshot()).toEqual({ status: 'signedOut', notice: null })
  })

  test('signOut calls the auth port', async () => {
    const { store, auth, emit } = await signedIn()

    await store.signOut()
    emit(null)

    expect(auth.signOut).toHaveBeenCalledOnce()
    expect(store.getSnapshot()).toEqual({ status: 'signedOut', notice: null })
  })
})

describe('subscribe', () => {
  test('the snapshot reference changes only on a change', async () => {
    const { store, emit } = setup()
    emit(null)
    const before = store.getSnapshot()

    emit(null)
    await store.signInWithEmail('a@b.c', 'pw')

    expect(store.getSnapshot()).toBe(before)

    emit(USER)

    expect(store.getSnapshot()).not.toBe(before)
  })

  test('listeners hear changes until they unsubscribe', () => {
    const { store, emit } = setup()
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)

    emit(null)
    expect(listener).toHaveBeenCalledOnce()

    unsubscribe()
    emit(USER)
    expect(listener).toHaveBeenCalledOnce()
  })
})
