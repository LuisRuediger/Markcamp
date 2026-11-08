import { describe, expect, test, vi } from 'vitest'
import type { ApiClient, ApiRequest, ApiResult, FieldError } from './apiClient'
import type { IdGenerator, Logger } from './ports'
import { createProjectsStore, type CreateProjectFailure, type Project } from './projectsStore'
import type { SessionKeySource } from './sessionStore'

const ok = (body: unknown, status = 200): ApiResult => ({ kind: 'ok', status, body })
const problem = (status: number, code: string, fieldErrors: readonly FieldError[] = []): ApiResult => ({
  kind: 'apiError',
  status,
  code,
  fieldErrors,
})
const UNAVAILABLE: ApiResult = { kind: 'unavailable' }
const UNAUTHORIZED: ApiResult = { kind: 'unauthorized' }
const NEVER = new Promise<ApiResult>(() => {})

function project(id: string, name: string): Project {
  return { id, name, role: 'OWNER', createdAt: '2026-11-07T12:00:00Z' }
}
const A = project('a', 'Sítio')
const B = project('b', 'Chácara')

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

function fakeSession(): SessionKeySource & { setKey(next: number | null): void } {
  let key: number | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSessionKey: () => key,
    setKey(next: number | null) {
      key = next
      listeners.forEach((listener) => listener())
    },
  }
}

/** 'storeThenLose' stores the project and answers unavailable: the response was lost on the way back. */
type Answer = ApiResult | Promise<ApiResult> | 'storeThenLose'

/** A minimal in-memory backend for /projects. Queued answers, per "METHOD path", win over it. */
function fakeServer(initial: readonly Project[]) {
  const projects: Project[] = [...initial]
  const queued = new Map<string, Answer[]>()

  function queue(route: string, ...answers: Answer[]): void {
    queued.set(route, [...(queued.get(route) ?? []), ...answers])
  }

  function respond(request: ApiRequest): ApiResult | Promise<ApiResult> {
    const route = `${request.method} ${request.path}`
    const forced = queued.get(route)?.shift()
    if (forced !== undefined && forced !== 'storeThenLose') return forced

    if (route === 'GET /projects') return ok({ items: [...projects] })
    if (request.method === 'GET' && request.path.startsWith('/projects/')) {
      const found = projects.find((item) => `/projects/${item.id}` === request.path)
      return found === undefined ? problem(404, 'PROJECT_NOT_FOUND') : ok(found)
    }
    if (route === 'POST /projects') {
      const { id, name } = request.body as { id: string; name: string }
      if (projects.some((item) => item.id === id)) return problem(409, 'ID_ALREADY_EXISTS')
      const created = project(id, name.trim())
      projects.push(created)
      return forced === 'storeThenLose' ? UNAVAILABLE : ok(created, 201)
    }
    throw new Error(`Unexpected request: ${route}`)
  }

  return { projects, queue, respond }
}

function setup(initial: readonly Project[] = []) {
  const session = fakeSession()
  const server = fakeServer(initial)
  const request = vi.fn<ApiClient['request']>(async (sent) => server.respond(sent))
  const api: ApiClient = { request, setUnauthorizedHandler: () => {} }
  let count = 0
  const ids = {
    newId: vi.fn<IdGenerator['newId']>(() => {
      count += 1
      return `id-${count}`
    }),
  } satisfies IdGenerator
  const logger = { error: vi.fn<Logger['error']>(), warn: vi.fn<Logger['warn']>() }
  const store = createProjectsStore(session, api, ids, logger)

  const sent = (route: string) =>
    request.mock.calls.map(([call]) => call).filter((call) => `${call.method} ${call.path}` === route)
  const postedIds = () => sent('POST /projects').map((call) => (call.body as { id: string }).id)
  const items = () => {
    const snapshot = store.getSnapshot()
    return snapshot.status === 'ready' ? snapshot.items : null
  }
  return { session, server, request, ids, logger, store, sent, postedIds, items }
}

/** Starts a session and waits for the first list. */
async function signedIn(initial: readonly Project[] = []) {
  const context = setup(initial)
  context.session.setKey(1)
  await vi.waitFor(() => expect(context.store.getSnapshot().status).toBe('ready'))
  return context
}

describe('list', () => {
  test('idle without a session, and nothing is requested', () => {
    const { store, request } = setup([A])

    expect(store.getSnapshot()).toEqual({ status: 'idle' })
    expect(request).not.toHaveBeenCalled()
  })

  test('a session start goes to loading, then ready with the items in the server order', async () => {
    const { store, session } = setup([B, A])

    session.setKey(1)
    expect(store.getSnapshot()).toEqual({ status: 'loading' })

    await vi.waitFor(() => expect(store.getSnapshot()).toEqual({ status: 'ready', items: [B, A] }))
  })

  test('an unavailable list gives unavailable; reload goes to loading, then ready', async () => {
    const { store, session, server } = setup([A])
    server.queue('GET /projects', UNAVAILABLE)

    session.setKey(1)
    await vi.waitFor(() => expect(store.getSnapshot()).toEqual({ status: 'unavailable' }))

    const reloaded = store.reload()
    expect(store.getSnapshot()).toEqual({ status: 'loading' })
    await reloaded

    expect(store.getSnapshot()).toEqual({ status: 'ready', items: [A] })
  })

  test('a failed reload from ready keeps the items shown', async () => {
    const { store, server } = await signedIn([A])
    const before = store.getSnapshot()
    server.queue('GET /projects', UNAVAILABLE)

    await store.reload()

    expect(store.getSnapshot()).toBe(before)
  })

  const SECRET = 'Apiário do vizinho'
  test.each([
    ['no items array', { projects: [{ ...A, name: SECRET }] }],
    ['items that is not an array', { items: { name: SECRET } }],
    ['an item without createdAt', { items: [{ id: 'a', name: SECRET, role: 'OWNER' }] }],
    ['an item with an unknown role', { items: [{ ...A, name: SECRET, role: 'ADMIN' }] }],
    ['an item with a numeric name', { items: [{ ...A, name: 42 }] }],
  ])('a list body with %s gives unavailable and one log with nothing from the body', async (_name, body) => {
    const { store, session, server, logger } = setup()
    server.queue('GET /projects', ok(body))

    session.setKey(1)
    await vi.waitFor(() => expect(store.getSnapshot()).toEqual({ status: 'unavailable' }))

    expect(logger.error).toHaveBeenCalledOnce()
    const message = logger.error.mock.calls[0]![0]
    expect(message).not.toContain(SECRET)
    expect(message).not.toContain('42')
    expect(message).not.toContain('ADMIN')
  })

  test('sign-out empties the items', async () => {
    const { store, session } = await signedIn([A])

    session.setKey(null)

    expect(store.getSnapshot()).toEqual({ status: 'idle' })
  })

  test('switching user empties the items and loads the new list', async () => {
    const { store, session, server } = await signedIn([A])
    server.projects.splice(0, server.projects.length, B) // The second account's projects.

    session.setKey(2)
    expect(store.getSnapshot()).toEqual({ status: 'loading' })

    await vi.waitFor(() => expect(store.getSnapshot()).toEqual({ status: 'ready', items: [B] }))
  })

  test('a list answer from the previous session that arrives after a switch is ignored', async () => {
    const { store, session, server, request } = setup([A])
    const late = deferred<ApiResult>()
    server.queue('GET /projects', late.promise)
    session.setKey(1)
    server.projects.splice(0, server.projects.length, B)
    session.setKey(2)
    await vi.waitFor(() => expect(store.getSnapshot()).toEqual({ status: 'ready', items: [B] }))
    const afterSwitch = store.getSnapshot()

    late.resolve(ok({ items: [A] }))
    await request.mock.results[0]!.value

    expect(store.getSnapshot()).toBe(afterSwitch)
  })

  test('a list answer that arrives after sign-out is ignored', async () => {
    const { store, session, server, request } = setup([A])
    const late = deferred<ApiResult>()
    server.queue('GET /projects', late.promise)
    session.setKey(1)
    session.setKey(null)

    late.resolve(ok({ items: [A] }))
    await request.mock.results[0]!.value

    expect(store.getSnapshot()).toEqual({ status: 'idle' })
  })

  test('within one session, an older list answer that arrives last is ignored', async () => {
    const { store, session, server, request } = setup([A])
    const old = deferred<ApiResult>()
    server.queue('GET /projects', old.promise)
    session.setKey(1)
    server.projects.push(B)
    await store.reload()
    expect(store.getSnapshot()).toEqual({ status: 'ready', items: [A, B] })

    old.resolve(ok({ items: [A] }))
    await request.mock.results[0]!.value

    expect(store.getSnapshot()).toEqual({ status: 'ready', items: [A, B] })
  })
})

describe('create', () => {
  test('201 gives null, appends the project at the end without sorting, and reloads', async () => {
    const zone = project('z', 'Zona')
    const { store, server, sent, items } = await signedIn([zone])
    server.queue('GET /projects', NEVER) // Holds the reload, to see what create itself put in items.

    await expect(store.create('Apiário')).resolves.toBeNull()

    expect(items()).toEqual([zone, project('id-1', 'Apiário')])
    expect(sent('GET /projects')).toHaveLength(2)
  })

  test('the name is sent exactly as typed', async () => {
    const { store, sent } = await signedIn()

    await store.create('  Sítio  ')

    expect(sent('POST /projects')[0]!.body).toEqual({ id: 'id-1', name: '  Sítio  ' })
  })

  test('an unavailable attempt, then a retry, sends the same ID and creates one project', async () => {
    const { store, server, postedIds } = await signedIn()
    server.queue('POST /projects', UNAVAILABLE)

    await expect(store.create('Teste')).resolves.toBe('unavailable')
    await expect(store.create('Teste')).resolves.toBeNull()

    expect(postedIds()).toEqual(['id-1', 'id-1'])
    expect(server.projects).toHaveLength(1)
  })

  test('after a success, the next creation uses a new ID', async () => {
    const { store, postedIds } = await signedIn()

    await store.create('Um')
    await store.create('Dois')

    expect(postedIds()).toEqual(['id-1', 'id-2'])
  })

  test("409 then GET 200 gives null and the server's name, even if the retry sent another name", async () => {
    const { store, server, sent, items } = await signedIn()
    server.queue('POST /projects', 'storeThenLose')
    await expect(store.create('Sítio')).resolves.toBe('unavailable')
    server.queue('GET /projects', NEVER)

    await expect(store.create('Sítio Pomerode')).resolves.toBeNull()

    expect(sent('GET /projects/id-1')).toHaveLength(1)
    expect(items()).toEqual([project('id-1', 'Sítio')])
    expect(server.projects).toHaveLength(1)
  })

  test('409 then GET 404 gives unknown, one log, and the next creation uses a new ID', async () => {
    const { store, server, logger, postedIds } = await signedIn()
    server.queue('POST /projects', problem(409, 'ID_ALREADY_EXISTS'))

    await expect(store.create('Sítio')).resolves.toBe('unknown')
    expect(logger.error).toHaveBeenCalledOnce()

    await expect(store.create('Sítio')).resolves.toBeNull()
    expect(postedIds()).toEqual(['id-1', 'id-2'])
  })

  test('two creations started together share the ID; both succeed, one project', async () => {
    const { store, server, ids, postedIds, items } = await signedIn()

    const results = await Promise.all([store.create('Sítio'), store.create('Sítio')])

    expect(results).toEqual([null, null])
    expect(ids.newId).toHaveBeenCalledOnce()
    expect(postedIds()).toEqual(['id-1', 'id-1'])
    expect(server.projects).toHaveLength(1)
    await vi.waitFor(() => expect(items()).toEqual([project('id-1', 'Sítio')]))
  })

  test.each<[string, CreateProjectFailure]>([
    ['REQUIRED', 'nameRequired'],
    ['TOO_LONG', 'nameTooLong'],
    ['INVALID_FORMAT', 'nameInvalid'],
    ['NOT_ALLOWED', 'unknown'],
  ])('a name field code %s gives %s and keeps the list', async (code, failure) => {
    const { store, server } = await signedIn([A])
    const before = store.getSnapshot()
    server.queue('POST /projects', problem(400, 'VALIDATION_FAILED', [{ field: 'name', code }]))

    await expect(store.create('x')).resolves.toBe(failure)

    expect(store.getSnapshot()).toBe(before)
  })

  test('VALIDATION_FAILED on id gives unknown, one log, and a new ID next time', async () => {
    const { store, server, logger, postedIds } = await signedIn()
    server.queue(
      'POST /projects',
      problem(400, 'VALIDATION_FAILED', [{ field: 'id', code: 'INVALID_FORMAT' }]),
    )

    await expect(store.create('Sítio')).resolves.toBe('unknown')
    expect(logger.error).toHaveBeenCalledOnce()

    await store.create('Sítio')
    expect(postedIds()).toEqual(['id-1', 'id-2'])
  })

  test('5xx gives unknown and the same ID next time', async () => {
    const { store, server, postedIds } = await signedIn()
    server.queue('POST /projects', problem(500, 'INTERNAL_ERROR'))

    await expect(store.create('Sítio')).resolves.toBe('unknown')
    await expect(store.create('Sítio')).resolves.toBeNull()

    expect(postedIds()).toEqual(['id-1', 'id-1'])
  })

  test('unauthorized gives unknown', async () => {
    const { store, server } = await signedIn()
    server.queue('POST /projects', UNAUTHORIZED)

    await expect(store.create('Sítio')).resolves.toBe('unknown')
  })

  test('a project already in items is replaced, not duplicated', async () => {
    const { store, server, items } = await signedIn()
    server.queue('POST /projects', 'storeThenLose')
    await store.create('Sítio')
    await store.reload()
    expect(items()).toEqual([project('id-1', 'Sítio')])
    server.queue('GET /projects', NEVER)

    await expect(store.create('Sítio')).resolves.toBeNull()

    expect(items()).toEqual([project('id-1', 'Sítio')])
  })

  test('a result for a session that already ended is returned, but the snapshot is not touched', async () => {
    const { store, session, server, sent } = await signedIn()
    const answer = deferred<ApiResult>()
    server.queue('POST /projects', answer.promise)
    const pending = store.create('Sítio')

    session.setKey(null)
    answer.resolve(ok(project('id-1', 'Sítio'), 201))

    await expect(pending).resolves.toBeNull()
    expect(store.getSnapshot()).toEqual({ status: 'idle' })
    expect(sent('GET /projects')).toHaveLength(1)
  })
})
