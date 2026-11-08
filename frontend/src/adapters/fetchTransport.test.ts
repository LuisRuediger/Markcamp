import { describe, expect, test, vi } from 'vitest'
import { NetworkError } from '../core/ports'
import { createFetchTransport } from './fetchTransport'

function jsonResponse(status: number, body: unknown, contentType = 'application/json') {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': contentType } })
}

function setup(answer: () => Promise<Response> = async () => jsonResponse(200, {})) {
  const fetchFn = vi.fn<typeof fetch>(answer)
  const lastHeaders = () => fetchFn.mock.lastCall![1]!.headers as Record<string, string>
  return { fetchFn, lastHeaders, transport: createFetchTransport('/api', fetchFn) }
}

describe('request', () => {
  test('the URL is base + path', async () => {
    const { fetchFn, transport } = setup()

    await transport.send({ method: 'GET', path: '/me' })

    expect(fetchFn.mock.lastCall![0]).toBe('/api/me')
    expect(fetchFn.mock.lastCall![1]!.method).toBe('GET')
  })

  test('Authorization is sent with a token', async () => {
    const { lastHeaders, transport } = setup()

    await transport.send({ method: 'GET', path: '/me', token: 'the-token' })

    expect(lastHeaders()['Authorization']).toBe('Bearer the-token')
  })

  test('Authorization is absent without a token', async () => {
    const { lastHeaders, transport } = setup()

    await transport.send({ method: 'GET', path: '/me' })

    expect(lastHeaders()).not.toHaveProperty('Authorization')
  })

  test('Content-Type is sent only with a body', async () => {
    const { fetchFn, lastHeaders, transport } = setup()

    await transport.send({ method: 'GET', path: '/me' })
    expect(lastHeaders()).not.toHaveProperty('Content-Type')

    await transport.send({ method: 'POST', path: '/projects', body: { name: 'x' } })
    expect(lastHeaders()['Content-Type']).toBe('application/json')
    expect(fetchFn.mock.lastCall![1]!.body).toBe('{"name":"x"}')
  })

  test.each(['', 'me', '//evil.example', 'https://evil.example'])(
    'the path "%s" is rejected and nothing is sent',
    async (path) => {
      const { fetchFn, transport } = setup()

      await expect(transport.send({ method: 'GET', path, token: 't' })).rejects.toThrow()

      expect(fetchFn).not.toHaveBeenCalled()
    },
  )
})

describe('response', () => {
  test('a problem+json body is parsed', async () => {
    const problem = { status: 404, code: 'PROJECT_NOT_FOUND' }
    const { transport } = setup(async () =>
      jsonResponse(404, problem, 'application/problem+json;charset=UTF-8'),
    )

    await expect(transport.send({ method: 'GET', path: '/me' })).resolves.toEqual({
      status: 404,
      body: problem,
    })
  })

  test('an HTML body gives null', async () => {
    const { transport } = setup(
      async () =>
        new Response('<html></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    )

    await expect(transport.send({ method: 'GET', path: '/me' })).resolves.toEqual({
      status: 502,
      body: null,
    })
  })

  test('invalid JSON gives null, not an exception', async () => {
    const { transport } = setup(
      async () =>
        new Response('{not json', { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )

    await expect(transport.send({ method: 'GET', path: '/me' })).resolves.toEqual({
      status: 200,
      body: null,
    })
  })

  test('a fetch rejection becomes a network error without the token', async () => {
    const token = 'the-secret-token'
    const { transport } = setup(async () => {
      throw new TypeError(`Invalid header value: Bearer ${token}`)
    })

    const error: unknown = await transport
      .send({ method: 'GET', path: '/me', token })
      .catch((rejection: unknown) => rejection)

    expect(error).toBeInstanceOf(NetworkError)
    expect((error as NetworkError).message).not.toContain(token)
    expect(String((error as NetworkError).stack)).not.toContain(token)
  })
})
