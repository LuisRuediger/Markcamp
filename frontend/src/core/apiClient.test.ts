import { describe, expect, test, vi } from 'vitest'
import { createApiClient } from './apiClient'
import { NetworkError, type ApiTransport, type TransportRequest, type TransportResponse } from './ports'

const UNAUTHORIZED: TransportResponse = { status: 401, body: null }
const OK: TransportResponse = { status: 200, body: { id: 'user-1' } }
const ME = { method: 'GET', path: '/me' } as const

// A promise-only retry loop never yields to timers, so a test timeout could not stop it.
// Past this many calls the fake throws, which makes a runaway retry fail instead of hang.
const RUNAWAY_LIMIT = 50

/** Answers in order; the last answer repeats forever. */
function fakeTransport(...answers: readonly [TransportResponse | Error, ...(TransportResponse | Error)[]]) {
  const calls: TransportRequest[] = []
  const transport: ApiTransport = {
    async send(request) {
      calls.push(request)
      if (calls.length > RUNAWAY_LIMIT) throw new Error('Runaway retry in the API client.')
      const answer = answers[Math.min(calls.length, answers.length) - 1]!
      if (answer instanceof Error) throw answer
      return answer
    },
  }
  return { transport, calls }
}

function fakeAuth() {
  return { getIdToken: vi.fn(async (force: boolean) => (force ? 'fresh-token' : 'cached-token')) }
}

function setup(...answers: Parameters<typeof fakeTransport>) {
  const auth = fakeAuth()
  const { transport, calls } = fakeTransport(...answers)
  const onUnauthorized = vi.fn()
  const client = createApiClient(auth, transport)
  client.setUnauthorizedHandler(onUnauthorized)
  return { auth, calls, onUnauthorized, client }
}

describe('token and 401', () => {
  test('the token from getIdToken(false) reaches the transport', async () => {
    const { auth, calls, client } = setup(OK)

    await client.request(ME)

    expect(auth.getIdToken).toHaveBeenCalledExactlyOnceWith(false)
    expect(calls).toEqual([{ ...ME, token: 'cached-token' }])
  })

  test('401 forces a refresh and repeats exactly once with the new token', async () => {
    const { auth, calls, client } = setup(UNAUTHORIZED, OK)

    const result = await client.request(ME)

    expect(auth.getIdToken.mock.calls).toEqual([[false], [true]])
    expect(calls.map((call) => call.token)).toEqual(['cached-token', 'fresh-token'])
    expect(result).toEqual({ kind: 'ok', status: 200, body: OK.body })
  })

  test('a 401 that never stops gives unauthorized, after two calls and one notification', async () => {
    const { calls, onUnauthorized, client } = setup(UNAUTHORIZED)

    const result = await client.request(ME)

    expect(result).toEqual({ kind: 'unauthorized' })
    expect(calls).toHaveLength(2)
    expect(onUnauthorized).toHaveBeenCalledOnce()
  })

  test('401 then 200 does not notify the session', async () => {
    const { onUnauthorized, client } = setup(UNAUTHORIZED, OK)

    await client.request(ME)

    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('unavailable keeps the person signed in', () => {
  test('token unavailable gives unavailable, sends nothing and does not sign out', async () => {
    const { auth, calls, onUnauthorized, client } = setup(OK)
    auth.getIdToken.mockRejectedValue(new Error('offline with an expired token'))

    const result = await client.request(ME)

    expect(result).toEqual({ kind: 'unavailable' })
    expect(calls).toHaveLength(0)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  test('refresh failing after a 401 gives unavailable and does not sign out', async () => {
    const { auth, calls, onUnauthorized, client } = setup(UNAUTHORIZED)
    auth.getIdToken.mockImplementation(async (force) => {
      if (force) throw new Error('offline')
      return 'cached-token'
    })

    const result = await client.request(ME)

    expect(result).toEqual({ kind: 'unavailable' })
    expect(calls).toHaveLength(1)
    expect(onUnauthorized).not.toHaveBeenCalled()
  })

  test('a transport network error gives unavailable', async () => {
    const { onUnauthorized, client } = setup(new NetworkError())

    const result = await client.request(ME)

    expect(result).toEqual({ kind: 'unavailable' })
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})

describe('non-2xx responses', () => {
  test('a Problem Details body becomes status and code, without detail or title', async () => {
    const { client } = setup({
      status: 404,
      body: { title: 'Not Found', detail: 'Project not found.', code: 'PROJECT_NOT_FOUND' },
    })

    const result = await client.request(ME)

    expect(result).toEqual({ kind: 'apiError', status: 404, code: 'PROJECT_NOT_FOUND' })
  })

  test.each([
    ['a non-JSON body', null],
    ['a body without code', { title: 'Bad Gateway' }],
    ['a code that is not a string', { code: 42 }],
  ])('%s gives a null code', async (_name, body) => {
    const { client } = setup({ status: 502, body })

    const result = await client.request(ME)

    expect(result).toEqual({ kind: 'apiError', status: 502, code: null })
  })
})
