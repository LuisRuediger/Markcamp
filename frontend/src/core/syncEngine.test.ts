import { describe, expect, test, vi } from 'vitest'
import type { ApiClient, ApiRequest, ApiResult } from './apiClient'
import type { BaitSiteEventType } from './baitSiteStateMachine'
import { createFakeLocalStore } from './fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from './historyOrder'
import type { LocalStore, ProjectRaw, ProjectsRaw, QueuePayload } from './localStore'
import type { Logger, Timers } from './ports'
import { createSyncEngine, type SyncPhase } from './syncEngine'
import { createBaitSiteRequest, createProjectRequest, recordEventRequest } from './syncProtocol'

// ---------------------------------------------------------------------------------------
// Test helpers: an in-memory server, a scripted API in front of it, manual timers.
// ---------------------------------------------------------------------------------------

const SERVER_TIME = '2026-11-10T12:00:00Z'
const T0 = toHistoryInstant('2026-11-01T10:00:00Z')!
const T1 = toHistoryInstant('2026-11-02T10:00:00.123456Z')!

const ok = (body: unknown, status = 200): ApiResult => ({ kind: 'ok', status, body })
const problem = (status: number, code: string | null): ApiResult => ({ kind: 'apiError', status, code, fieldErrors: [] })
const UNAVAILABLE: ApiResult = { kind: 'unavailable' }
/** The server handles the request, the answer is lost on the way back. */
const lose = (answer: () => ApiResult): ApiResult => {
  answer()
  return UNAVAILABLE
}

function read(body: unknown, key: string): unknown {
  if (typeof body !== 'object' || body === null) throw new Error(`test server: no body for ${key}`)
  return Reflect.get(body, key)
}
function text(body: unknown, key: string): string {
  const value = read(body, key)
  if (typeof value !== 'string') throw new Error(`test server: ${key} is not a string`)
  return value
}
function textOrNull(body: unknown, key: string): string | null {
  const value = read(body, key)
  return value === null ? null : text(body, key)
}
function numberOf(body: unknown, key: string): number {
  const value = read(body, key)
  if (typeof value !== 'number') throw new Error(`test server: ${key} is not a number`)
  return value
}

interface ServerEvent {
  readonly id: string
  readonly projectId: string
  readonly baitSiteId: string
  readonly type: string
  readonly occurredAt: string
  readonly speciesId: string | null
  readonly identifiedEventId: string | null
  voidedAt: string | null
}

/** "...10:00:00.000000Z" -> "...10:00:00.000Z": Jackson's milliseconds, normalized again by the parser. */
const asJackson = (instant: string) => instant.replace(/000Z$/, 'Z')

/** The API as the backend answers it, for the routes the engine uses. */
function createServer() {
  const projects = new Map<string, { id: string; name: string }>()
  const sites = new Map<
    string,
    { id: string; projectId: string; name: string; latitude: number; longitude: number; locationAccuracyM: number | null }
  >()
  const events = new Map<string, ServerEvent>()
  const species = [{ id: 'species-1', scientificName: 'Tetragonisca angustula', commonName: 'Jataí' }]

  const projectBody = (project: { id: string; name: string }) => ({ ...project, role: 'OWNER', createdAt: SERVER_TIME })
  const siteBody = (id: string) => {
    const { projectId: _, ...site } = sites.get(id)!
    return { ...site, status: 'ARMED', createdAt: SERVER_TIME, extra: 'not copied' }
  }
  const eventBody = (event: ServerEvent) => ({
    id: event.id,
    baitSiteId: event.baitSiteId,
    type: event.type,
    occurredAt: asJackson(event.occurredAt),
    speciesId: event.speciesId,
    identifiedEventId: event.identifiedEventId,
    recordedAt: SERVER_TIME,
    voidedAt: event.voidedAt,
  })
  const siteOf = (projectId: string, siteId: string) => {
    const site = sites.get(siteId)
    return site !== undefined && site.projectId === projectId ? site : undefined
  }

  function handle({ method, path, body }: ApiRequest): ApiResult {
    const parts = path.split('/').slice(1)
    const route = `${method} ${parts.map((part, index) => (index % 2 === 1 ? '*' : part)).join('/')}`
    const [, p = '', , s = '', , e = ''] = parts
    switch (route) {
      case 'GET projects':
        return ok({ items: [...projects.values()].map(projectBody) })
      case 'POST projects': {
        const id = text(body, 'id')
        if (projects.has(id)) return problem(409, 'ID_ALREADY_EXISTS')
        projects.set(id, { id, name: text(body, 'name') })
        return ok(projectBody(projects.get(id)!), 201)
      }
      case 'GET projects/*': {
        const project = projects.get(p)
        return project === undefined ? problem(404, 'PROJECT_NOT_FOUND') : ok(projectBody(project))
      }
      case 'GET projects/*/bait-sites':
        if (!projects.has(p)) return problem(404, 'PROJECT_NOT_FOUND')
        return ok({ items: [...sites.values()].filter((site) => site.projectId === p).map((site) => siteBody(site.id)) })
      case 'POST projects/*/bait-sites': {
        if (!projects.has(p)) return problem(404, 'PROJECT_NOT_FOUND')
        const id = text(body, 'id')
        if (sites.has(id)) return problem(409, 'ID_ALREADY_EXISTS')
        sites.set(id, {
          id,
          projectId: p,
          name: text(body, 'name'),
          latitude: numberOf(body, 'latitude'),
          longitude: numberOf(body, 'longitude'),
          locationAccuracyM: read(body, 'locationAccuracyM') === null ? null : numberOf(body, 'locationAccuracyM'),
        })
        const installation = read(body, 'installation')
        const installedId = text(installation, 'id')
        events.set(installedId, {
          id: installedId,
          projectId: p,
          baitSiteId: id,
          type: 'INSTALLED',
          occurredAt: text(installation, 'occurredAt'),
          speciesId: null,
          identifiedEventId: null,
          voidedAt: null,
        })
        return ok(siteBody(id), 201)
      }
      case 'GET projects/*/bait-sites/*':
        return siteOf(p, s) === undefined ? problem(404, 'BAIT_SITE_NOT_FOUND') : ok(siteBody(s))
      case 'POST projects/*/bait-sites/*/events': {
        if (siteOf(p, s) === undefined) return problem(404, 'BAIT_SITE_NOT_FOUND')
        const id = text(body, 'id')
        if (events.has(id)) return problem(409, 'ID_ALREADY_EXISTS')
        const event: ServerEvent = {
          id,
          projectId: p,
          baitSiteId: s,
          type: text(body, 'type'),
          occurredAt: text(body, 'occurredAt'),
          speciesId: textOrNull(body, 'speciesId'),
          identifiedEventId: textOrNull(body, 'identifiedEventId'),
          voidedAt: null,
        }
        events.set(id, event)
        return ok(eventBody(event), 201)
      }
      case 'GET projects/*/bait-sites/*/events/*': {
        const event = events.get(e)
        return event === undefined || event.baitSiteId !== s || siteOf(p, s) === undefined
          ? problem(404, 'BAIT_SITE_EVENT_NOT_FOUND')
          : ok(eventBody(event))
      }
      case 'POST projects/*/bait-sites/*/events/*/void': {
        const event = events.get(e)
        if (event === undefined || event.baitSiteId !== s) return problem(404, 'BAIT_SITE_EVENT_NOT_FOUND')
        event.voidedAt ??= SERVER_TIME
        return ok(eventBody(event))
      }
      case 'GET projects/*/events':
        if (!projects.has(p)) return problem(404, 'PROJECT_NOT_FOUND')
        return ok({
          items: [...events.values()].filter((event) => event.projectId === p && event.voidedAt === null).map(eventBody),
        })
      case 'GET species':
        return ok({ items: species })
      default:
        throw new Error(`test server: no route ${route}`)
    }
  }

  return { handle, projects, sites, events, species }
}

type Interceptor = (request: ApiRequest, answer: () => ApiResult) => ApiResult | Promise<ApiResult>
const passThrough: Interceptor = (_, answer) => answer()

function createManualTimers() {
  const armed = new Map<number, { readonly ms: number; readonly callback: () => void }>()
  let nextId = 0
  const timers: Timers = {
    after(ms, callback) {
      const id = nextId++
      armed.set(id, { ms, callback })
      return () => {
        armed.delete(id)
      }
    },
  }
  return {
    timers,
    armed: () => [...armed.values()],
    fire() {
      const [entry] = armed
      if (entry === undefined) throw new Error('no timer armed')
      armed.delete(entry[0])
      entry[1].callback()
    },
  }
}

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => (resolve = done))
  return { promise, resolve }
}

/**
 * Lets pending promise chains run (store writes, scripted answers). Microtasks only: core is
 * compiled without timers (ADR 0007), and every fake here settles on microtasks.
 */
async function flush(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
}

function setup(options: { store?: LocalStore } = {}) {
  const server = createServer()
  const store = options.store ?? createFakeLocalStore()
  const requests: ApiRequest[] = []
  let inFlight = 0
  let overlaps = 0
  let interceptor: Interceptor = passThrough
  const api: Pick<ApiClient, 'request'> = {
    async request(request) {
      if (inFlight > 0) overlaps += 1
      inFlight += 1
      requests.push(request)
      try {
        await Promise.resolve() // A real answer is never synchronous.
        return await interceptor(request, () => server.handle(request))
      } finally {
        inFlight -= 1
      }
    },
  }
  const manual = createManualTimers()
  const errors: string[] = []
  const logger: Logger = { error: (message) => errors.push(message), warn: vi.fn() }
  const engine = createSyncEngine({ api, store, timers: manual.timers, logger })

  return {
    server,
    store,
    engine,
    manual,
    errors,
    requests,
    /** "METHOD path" of every request, in order. */
    routes: () => requests.map((request) => `${request.method} ${request.path}`),
    overlaps: () => overlaps,
    intercept(next: Interceptor) {
      interceptor = next
    },
    /** The route answers this once (or always), the rest goes to the server. */
    answerOnce(route: string, result: ApiResult | ((answer: () => ApiResult) => ApiResult | Promise<ApiResult>)) {
      let used = false
      const previous = interceptor
      interceptor = (request, answer) => {
        if (!used && `${request.method} ${request.path}` === route) {
          used = true
          return typeof result === 'function' ? result(answer) : result
        }
        return previous(request, answer)
      }
    },
    async enqueue(...payloads: QueuePayload[]) {
      for (const payload of payloads) await store.enqueue(payload)
    },
    async project(projectId = P): Promise<ProjectRaw> {
      const observable = store.observeProject(projectId)
      const unsubscribe = observable.subscribe(() => {})
      await flush()
      const snapshot = observable.getSnapshot()
      unsubscribe()
      if (snapshot.status !== 'ready') throw new Error('project not loaded')
      return snapshot.value
    },
    async projects(): Promise<ProjectsRaw> {
      const observable = store.observeProjects()
      const unsubscribe = observable.subscribe(() => {})
      await flush()
      const snapshot = observable.getSnapshot()
      unsubscribe()
      if (snapshot.status !== 'ready') throw new Error('projects not loaded')
      return snapshot.value
    },
  }
}

const P = 'project-1'
const Q = 'project-2'

type Payload<K extends QueuePayload['kind']> = Extract<QueuePayload, { readonly kind: K }>

const createProject = (projectId = P, name = 'Sítio'): Payload<'createProject'> => ({
  kind: 'createProject',
  projectId,
  name,
})
const createSite = (baitSiteId: string, projectId = P): Payload<'createBaitSite'> => ({
  kind: 'createBaitSite',
  projectId,
  baitSiteId,
  name: `Site ${baitSiteId}`,
  latitude: -27.1,
  longitude: -49.5,
  locationAccuracyM: 4.5,
  installation: { id: `${baitSiteId}-installed`, occurredAt: T0 },
})
const recordEvent = (
  eventId: string,
  baitSiteId: string,
  type: BaitSiteEventType = 'ACTIVITY',
  occurredAt: HistoryInstant = T1,
  projectId = P,
): Payload<'recordEvent'> => ({
  kind: 'recordEvent',
  projectId,
  baitSiteId,
  eventId,
  type,
  occurredAt,
  speciesId: null,
  identifiedEventId: null,
})
const voidEvent = (eventId: string, baitSiteId: string, projectId = P): Payload<'voidEvent'> => ({
  kind: 'voidEvent',
  projectId,
  baitSiteId,
  eventId,
})

/** Puts a project and its sites on the server directly, as if uploaded earlier. */
function seedServer(server: ReturnType<typeof createServer>, projectId: string, siteIds: readonly string[]) {
  server.handle(createProjectRequest(createProject(projectId)))
  for (const siteId of siteIds) server.handle(createBaitSiteRequest(createSite(siteId, projectId)))
}

const SEQ_REJECTED = { status: 409, code: 'INVALID_EVENT_SEQUENCE' }

// ---------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------

describe('upload', () => {
  test('4. one item of each kind is sent with the exact request and confirmed with the answer', async () => {
    const t = setup()
    await t.enqueue(
      createProject(),
      createSite('site-a'),
      recordEvent('event-1', 'site-a', 'CAPTURED'),
      recordEvent('event-2', 'site-a', 'INSPECTED'),
      voidEvent('event-2', 'site-a'),
    )

    await t.engine.requestSync('upload')

    expect(t.requests).toEqual([
      { method: 'POST', path: '/projects', body: { id: P, name: 'Sítio' } },
      {
        method: 'POST',
        path: `/projects/${P}/bait-sites`,
        body: {
          id: 'site-a',
          name: 'Site site-a',
          latitude: -27.1,
          longitude: -49.5,
          locationAccuracyM: 4.5,
          installation: { id: 'site-a-installed', occurredAt: T0 },
        },
      },
      { method: 'GET', path: `/projects/${P}/bait-sites/site-a/events/site-a-installed` },
      {
        method: 'POST',
        path: `/projects/${P}/bait-sites/site-a/events`,
        body: { id: 'event-1', type: 'CAPTURED', occurredAt: T1, speciesId: null, identifiedEventId: null },
      },
      {
        method: 'POST',
        path: `/projects/${P}/bait-sites/site-a/events`,
        body: { id: 'event-2', type: 'INSPECTED', occurredAt: T1, speciesId: null, identifiedEventId: null },
      },
      { method: 'POST', path: `/projects/${P}/bait-sites/site-a/events/event-2/void` },
    ])
    expect(t.requests[5]).not.toHaveProperty('body')

    const copy = await t.project()
    expect(copy.queue).toEqual([])
    expect(copy.project).toStrictEqual({ id: P, name: 'Sítio', role: 'OWNER', createdAt: SERVER_TIME })
    expect(copy.baitSites).toStrictEqual([
      {
        id: 'site-a',
        projectId: P,
        name: 'Site site-a',
        latitude: -27.1,
        longitude: -49.5,
        locationAccuracyM: 4.5,
        createdAt: SERVER_TIME,
      },
    ])
    // event-2 was voided: a confirmed void deletes it from the copy.
    expect(copy.events.map((event) => event.id).toSorted()).toEqual(['event-1', 'site-a-installed'])
    expect(copy.events.find((event) => event.id === 'event-1')).toStrictEqual({
      id: 'event-1',
      projectId: P,
      baitSiteId: 'site-a',
      type: 'CAPTURED',
      occurredAt: T1,
      speciesId: null,
      identifiedEventId: null,
      recordedAt: SERVER_TIME,
    })
    expect(t.engine.getSnapshot()).toEqual({ phase: 'idle', lastResult: 'synced' })
    expect(t.errors).toEqual([])
  })

  test('5. a bait site is confirmed together with its INSTALLED, in one step', async () => {
    const t = setup()
    seedServer(t.server, P, [])
    await t.enqueue(createSite('site-a'))
    const observable = t.store.observeProject(P)
    const seen: string[] = []
    observable.subscribe(() => {
      const snapshot = observable.getSnapshot()
      if (snapshot.status !== 'ready') return
      const hasSite = snapshot.value.baitSites.some((site) => site.id === 'site-a')
      const hasInstalled = snapshot.value.events.some((event) => event.id === 'site-a-installed')
      seen.push(`site:${hasSite} installed:${hasInstalled}`)
    })
    await flush()

    await t.engine.requestSync('upload')

    expect(t.routes()).toEqual([
      `POST /projects/${P}/bait-sites`,
      `GET /projects/${P}/bait-sites/site-a/events/site-a-installed`,
    ])
    expect(seen).not.toContain('site:true installed:false')
    expect(seen.at(-1)).toBe('site:true installed:true')
    const copy = await t.project()
    expect(copy.events).toStrictEqual([
      {
        id: 'site-a-installed',
        projectId: P,
        baitSiteId: 'site-a',
        type: 'INSTALLED',
        occurredAt: T0,
        speciesId: null,
        identifiedEventId: null,
        recordedAt: SERVER_TIME,
      },
    ])
  })

  test('6. items of two sites go strictly in seq order, one request at a time', async () => {
    const t = setup()
    seedServer(t.server, P, [])
    await t.enqueue(
      createSite('site-a'),
      createSite('site-b'),
      recordEvent('event-a1', 'site-a'),
      recordEvent('event-b1', 'site-b'),
      recordEvent('event-a2', 'site-a', 'INSPECTED'),
    )

    await t.engine.requestSync('upload')

    expect(t.routes()).toEqual([
      `POST /projects/${P}/bait-sites`,
      `GET /projects/${P}/bait-sites/site-a/events/site-a-installed`,
      `POST /projects/${P}/bait-sites`,
      `GET /projects/${P}/bait-sites/site-b/events/site-b-installed`,
      `POST /projects/${P}/bait-sites/site-a/events`,
      `POST /projects/${P}/bait-sites/site-b/events`,
      `POST /projects/${P}/bait-sites/site-a/events`,
    ])
    expect(t.requests.map((request) => read(request.body ?? {}, 'id'))).toEqual([
      'site-a',
      undefined,
      'site-b',
      undefined,
      'event-a1',
      'event-b1',
      'event-a2',
    ])
    expect(t.overlaps()).toBe(0)
    expect(await t.store.queuedItems()).toEqual([])
  })

  test('7. unavailable on the second item: the first is confirmed, the rest untouched, no further request', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a'), recordEvent('event-3', 'site-a'))
    let posts = 0
    t.intercept((request, answer) => (request.method === 'POST' && ++posts === 2 ? UNAVAILABLE : answer()))

    await t.engine.requestSync('upload')

    expect(t.requests).toHaveLength(2)
    const queue = await t.store.queuedItems()
    expect(queue.map((item) => [item.seq, item.rejection])).toEqual([
      [2, null],
      [3, null],
    ])
    expect((await t.project()).events.map((event) => event.id)).toEqual(['event-1'])
    expect(t.engine.getSnapshot().lastResult).toBe('unavailable')
  })

  test.each([
    ['a 5xx', problem(500, 'INTERNAL_ERROR')],
    ['unauthorized', { kind: 'unauthorized' } satisfies ApiResult],
  ])('7b. %s defers the same way', async (_, answer) => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, answer)

    await t.engine.requestSync('upload')

    expect(t.requests).toHaveLength(1)
    expect((await t.store.queuedItems()).map((item) => item.rejection)).toEqual([null, null])
  })

  describe('8. the server stored it but the answer was lost: the next pass confirms through 409 -> GET', () => {
    test('project', async () => {
      const t = setup()
      await t.enqueue(createProject())
      t.answerOnce('POST /projects', lose)

      await t.engine.requestSync('upload')
      expect((await t.store.queuedItems()).length).toBe(1)

      await t.engine.requestSync('upload')

      expect(t.routes()).toEqual(['POST /projects', 'POST /projects', `GET /projects/${P}`])
      const copy = await t.project()
      expect(copy.queue).toEqual([])
      expect(copy.project).toStrictEqual({ id: P, name: 'Sítio', role: 'OWNER', createdAt: SERVER_TIME })
    })

    test('bait site: the POST answer lost', async () => {
      const t = setup()
      seedServer(t.server, P, [])
      await t.enqueue(createSite('site-a'))
      t.answerOnce(`POST /projects/${P}/bait-sites`, lose)

      await t.engine.requestSync('upload')
      await t.engine.requestSync('upload')

      expect(t.routes()).toEqual([
        `POST /projects/${P}/bait-sites`,
        `POST /projects/${P}/bait-sites`,
        `GET /projects/${P}/bait-sites/site-a`,
        `GET /projects/${P}/bait-sites/site-a/events/site-a-installed`,
      ])
      const copy = await t.project()
      expect(copy.queue).toEqual([])
      expect(copy.baitSites.map((site) => [site.id, site.createdAt])).toEqual([['site-a', SERVER_TIME]])
      expect(copy.events.map((event) => [event.id, event.recordedAt])).toEqual([['site-a-installed', SERVER_TIME]])
    })

    test('bait site: POST ok, the GET of the INSTALLED unavailable', async () => {
      const t = setup()
      seedServer(t.server, P, [])
      await t.enqueue(createSite('site-a'))
      t.answerOnce(`GET /projects/${P}/bait-sites/site-a/events/site-a-installed`, UNAVAILABLE)

      await t.engine.requestSync('upload')
      const between = await t.project()
      expect(between.queue).toHaveLength(1)
      expect(between.baitSites).toEqual([])

      await t.engine.requestSync('upload')

      expect(t.routes().slice(2)).toEqual([
        `POST /projects/${P}/bait-sites`,
        `GET /projects/${P}/bait-sites/site-a`,
        `GET /projects/${P}/bait-sites/site-a/events/site-a-installed`,
      ])
      const copy = await t.project()
      expect(copy.queue).toEqual([])
      expect(copy.baitSites.map((site) => site.id)).toEqual(['site-a'])
      expect(copy.events.map((event) => event.id)).toEqual(['site-a-installed'])
    })

    test('event', async () => {
      const t = setup()
      seedServer(t.server, P, ['site-a'])
      await t.enqueue(recordEvent('event-1', 'site-a', 'CAPTURED'))
      t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, lose)

      await t.engine.requestSync('upload')
      await t.engine.requestSync('upload')

      expect(t.routes().slice(1)).toEqual([
        `POST /projects/${P}/bait-sites/site-a/events`,
        `GET /projects/${P}/bait-sites/site-a/events/event-1`,
      ])
      const copy = await t.project()
      expect(copy.queue).toEqual([])
      expect(copy.events.map((event) => [event.id, event.type, event.occurredAt])).toEqual([['event-1', 'CAPTURED', T1]])
    })
  })

  test('9. 409 ID_ALREADY_EXISTS and then 404 on the GET: rejected as 409 ID_ALREADY_EXISTS, error logged', async () => {
    const t = setup()
    await t.enqueue(createProject())
    t.answerOnce('POST /projects', problem(409, 'ID_ALREADY_EXISTS'))

    await t.engine.requestSync('upload')

    expect(t.routes()).toEqual(['POST /projects', `GET /projects/${P}`])
    const [item] = await t.store.queuedItems()
    expect(item?.rejection).toEqual({ status: 409, code: 'ID_ALREADY_EXISTS' })
    expect(t.errors).toEqual(['Sync upload: a create answered ID_ALREADY_EXISTS for an id that is not ours.'])
  })

  test('9b. a GET after ID_ALREADY_EXISTS that finds the event voided rejects it', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, (answer) => {
      answer()
      t.server.events.get('event-1')!.voidedAt = SERVER_TIME
      return problem(409, 'ID_ALREADY_EXISTS')
    })

    await t.engine.requestSync('upload')

    const [item] = await t.store.queuedItems()
    expect(item?.rejection).toEqual({ status: 409, code: 'ID_ALREADY_EXISTS' })
    expect(t.errors).toHaveLength(1)
  })

  test('10. INVALID_EVENT_SEQUENCE on site A: A waits, site B goes on; a second pass sends nothing for A', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a', 'site-b'])
    await t.enqueue(
      recordEvent('event-a1', 'site-a'),
      recordEvent('event-b1', 'site-b'),
      recordEvent('event-a2', 'site-a', 'INSPECTED'),
      recordEvent('event-b2', 'site-b', 'INSPECTED'),
    )
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, problem(409, 'INVALID_EVENT_SEQUENCE'))

    await t.engine.requestSync('upload')

    expect(t.requests.map((request) => read(request.body, 'id'))).toEqual(['event-a1', 'event-b1', 'event-b2'])
    expect((await t.store.queuedItems()).map((item) => [item.seq, item.rejection])).toEqual([
      [1, SEQ_REJECTED],
      [3, null],
    ])
    // The INSTALLED events were seeded on the server only: the copy has what was confirmed.
    expect((await t.project()).events.map((event) => event.id).toSorted()).toEqual(['event-b1', 'event-b2'])
    // Rejected items left do not make the result unavailable.
    expect(t.engine.getSnapshot().lastResult).toBe('synced')

    await t.engine.requestSync('upload')
    expect(t.requests).toHaveLength(3)
  })

  test('11. after clearRejection and requestSync, the item is sent again', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-a1', 'site-a'), recordEvent('event-a2', 'site-a', 'INSPECTED'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, problem(409, 'INVALID_EVENT_SEQUENCE'))
    await t.engine.requestSync('upload')
    expect(t.requests).toHaveLength(1)

    await t.store.clearRejection(1)
    await t.engine.requestSync('upload')

    expect(t.requests.map((request) => read(request.body, 'id'))).toEqual(['event-a1', 'event-a1', 'event-a2'])
    expect(await t.store.queuedItems()).toEqual([])
  })

  test('11b. an item retried by the user during the pass is not sent twice in that pass; the next pass sends it', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a', 'site-b'])
    await t.enqueue(recordEvent('event-a1', 'site-a'), recordEvent('event-b1', 'site-b'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, problem(409, 'INVALID_EVENT_SEQUENCE'))
    const gate = deferred()
    t.answerOnce(`POST /projects/${P}/bait-sites/site-b/events`, async (answer) => {
      await gate.promise
      return answer()
    })

    const done = t.engine.requestSync('upload')
    await flush()
    await t.store.clearRejection(1)
    gate.resolve()
    await done

    expect(t.requests.map((request) => read(request.body, 'id'))).toEqual(['event-a1', 'event-b1'])
    expect(t.manual.armed()).toHaveLength(1)

    await t.engine.requestSync('upload')
    expect(t.requests.map((request) => read(request.body, 'id'))).toEqual(['event-a1', 'event-b1', 'event-a1'])
    expect(await t.store.queuedItems()).toEqual([])
  })

  test('12. a rejected createProject: none of that project is sent, another project is', async () => {
    const t = setup()
    await t.enqueue(
      createProject(P),
      createSite('site-p', P),
      createProject(Q),
      recordEvent('event-p', 'site-p'),
      createSite('site-q', Q),
    )
    t.answerOnce('POST /projects', problem(400, 'VALIDATION_FAILED'))

    await t.engine.requestSync('upload')

    expect(t.routes()).toEqual([
      'POST /projects',
      'POST /projects',
      `POST /projects/${Q}/bait-sites`,
      `GET /projects/${Q}/bait-sites/site-q/events/site-q-installed`,
    ])
    expect(read(t.requests[1]?.body, 'id')).toBe(Q)
    expect((await t.store.queuedItems()).map((item) => [item.seq, item.rejection])).toEqual([
      [1, { status: 400, code: 'VALIDATION_FAILED' }],
      [2, null],
      [4, null],
    ])
  })

  test('13. ok with an invalid body: the item is untouched, an error is logged, the upload stops', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a'))
    const before = await t.store.queuedItems()
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, ok({ id: 'event-1' }))

    await t.engine.requestSync('upload')

    expect(t.requests).toHaveLength(1)
    expect(await t.store.queuedItems()).toEqual(before)
    expect(t.errors).toEqual(['Sync upload: POST of an event returned a body that is not a valid event.'])
    expect(t.engine.getSnapshot().lastResult).toBe('unavailable')
  })

  test('14a. an item enqueued while a request is in flight is sent in the same pass', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))
    const gate = deferred()
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, async (answer) => {
      await gate.promise
      return answer()
    })

    const done = t.engine.requestSync('upload')
    await flush()
    expect(t.requests).toHaveLength(1)
    await t.enqueue(recordEvent('event-2', 'site-a', 'INSPECTED'))
    gate.resolve()
    await done

    expect(t.requests.map((request) => read(request.body, 'id'))).toEqual(['event-1', 'event-2'])
    expect(await t.store.queuedItems()).toEqual([])
  })

  test('14b. an item discarded while its request is in flight: nothing written, the pass goes on', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a', 'INSPECTED'))
    const gate = deferred()
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, async (answer) => {
      await gate.promise
      return answer()
    })

    const done = t.engine.requestSync('upload')
    await flush()
    await t.store.discard(1)
    gate.resolve()
    await done

    expect(t.requests).toHaveLength(2)
    expect((await t.project()).events.map((event) => event.id)).toEqual(['event-2'])
    expect(await t.store.queuedItems()).toEqual([])
    expect(t.errors).toEqual([])
  })

  test('a void answer that is not the voided event is an invalid body', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    t.server.handle(recordEventRequest(recordEvent('event-1', 'site-a')))
    await t.enqueue(voidEvent('event-1', 'site-a'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events/event-1/void`, ok({ id: 'event-1' }))

    await t.engine.requestSync('upload')

    expect(t.errors).toEqual(['Sync upload: POST of a void returned a body that is not the voided event.'])
    expect(await t.store.queuedItems()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------------------

describe('download', () => {
  function seedTwoProjects(server: ReturnType<typeof createServer>) {
    seedServer(server, P, ['site-a', 'site-b'])
    seedServer(server, Q, ['site-q'])
    server.handle(recordEventRequest(recordEvent('event-a1', 'site-a', 'ACTIVITY', T1)))
  }

  test('15. full with an empty queue: requests in order, species once, the copy equals the server', async () => {
    const t = setup()
    seedTwoProjects(t.server)

    await t.engine.requestSync('full')

    expect(t.routes()).toEqual([
      'GET /projects',
      'GET /species',
      `GET /projects/${P}/bait-sites`,
      `GET /projects/${P}/events`,
      `GET /projects/${Q}/bait-sites`,
      `GET /projects/${Q}/events`,
    ])
    expect((await t.projects()).projects.map((project) => project.id)).toEqual([P, Q])
    const p = await t.project(P)
    expect(p.baitSites.map((site) => site.id)).toEqual(['site-a', 'site-b'])
    expect(p.events.map((event) => event.id).toSorted()).toEqual(['event-a1', 'site-a-installed', 'site-b-installed'])
    expect(p.events.every((event) => event.projectId === P)).toBe(true)
    expect(p.species).toStrictEqual(t.server.species)
    const q = await t.project(Q)
    expect(q.baitSites.map((site) => [site.id, site.projectId])).toEqual([['site-q', Q]])
    expect(q.events.map((event) => event.id)).toEqual(['site-q-installed'])
    expect(t.engine.getSnapshot()).toEqual({ phase: 'idle', lastResult: 'synced' })
  })

  test('15b. no project on the server: the project list is replaced, species are not fetched', async () => {
    const t = setup()

    await t.engine.requestSync('full')

    expect(t.routes()).toEqual(['GET /projects'])
    expect(t.engine.getSnapshot().lastResult).toBe('synced')
  })

  test('16. upload never downloads', async () => {
    const t = setup()
    seedTwoProjects(t.server)

    await t.engine.requestSync('upload')

    expect(t.requests).toEqual([])
    expect(t.engine.getSnapshot().lastResult).toBe('synced')
  })

  test('17. upload deferred: no download; the next pass that is not deferred downloads (owed), the one after does not', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, UNAVAILABLE)

    await t.engine.requestSync('full')
    expect(t.routes()).toEqual([`POST /projects/${P}/bait-sites/site-a/events`])
    expect(t.engine.getSnapshot().lastResult).toBe('unavailable')

    await t.engine.requestSync('upload')
    expect(t.routes().slice(1)).toEqual([
      `POST /projects/${P}/bait-sites/site-a/events`,
      'GET /projects',
      'GET /species',
      `GET /projects/${P}/bait-sites`,
      `GET /projects/${P}/events`,
    ])
    expect(t.engine.getSnapshot().lastResult).toBe('synced')

    await t.engine.requestSync('upload')
    expect(t.requests).toHaveLength(6)
  })

  test('18. upload ends with a rejected item left: the download still runs, the queue is unchanged', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, problem(409, 'INVALID_EVENT_SEQUENCE'))

    await t.engine.requestSync('full')

    expect(t.routes()).toEqual([
      `POST /projects/${P}/bait-sites/site-a/events`,
      'GET /projects',
      'GET /species',
      `GET /projects/${P}/bait-sites`,
      `GET /projects/${P}/events`,
    ])
    const queue = await t.store.queuedItems()
    expect(queue).toEqual([{ seq: 1, payload: recordEvent('event-1', 'site-a'), rejection: SEQ_REJECTED }])
    expect((await t.project()).baitSites.map((site) => site.id)).toEqual(['site-a'])
    expect(t.engine.getSnapshot().lastResult).toBe('synced')
  })

  test('19. the download starts after the upload of the same pass ended, so a confirmation is never overwritten', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a', 'INSPECTED'))
    // Slow uploads: a download that did not wait would answer first, with a snapshot from before them.
    t.intercept(async (request, answer) => {
      if (request.method === 'POST') await flush()
      return answer()
    })

    await t.engine.requestSync('full')

    const routes = t.routes()
    const lastPost = routes.findLastIndex((route) => route.startsWith('POST'))
    expect(lastPost).toBe(1)
    expect(routes.indexOf('GET /projects')).toBe(2)
    expect(t.overlaps()).toBe(0)
    expect((await t.project()).events.map((event) => event.id).toSorted()).toEqual([
      'event-1',
      'event-2',
      'site-a-installed',
    ])
  })

  test('20. the events request of the second project fails: the first is replaced, the second untouched, still owed', async () => {
    const t = setup()
    seedTwoProjects(t.server)
    t.answerOnce(`GET /projects/${Q}/events`, UNAVAILABLE)

    await t.engine.requestSync('full')

    expect((await t.project(P)).baitSites.map((site) => site.id)).toEqual(['site-a', 'site-b'])
    expect((await t.project(Q)).baitSites).toEqual([])
    expect(t.engine.getSnapshot().lastResult).toBe('unavailable')

    await t.engine.requestSync('upload')
    expect(t.routes().slice(6)).toEqual([
      'GET /projects',
      'GET /species',
      `GET /projects/${P}/bait-sites`,
      `GET /projects/${P}/events`,
      `GET /projects/${Q}/bait-sites`,
      `GET /projects/${Q}/events`,
    ])
    expect((await t.project(Q)).baitSites.map((site) => site.id)).toEqual(['site-q'])
    expect(t.engine.getSnapshot().lastResult).toBe('synced')
  })

  test('21. an invalid snapshot body (one bad event): that project untouched, error logged', async () => {
    const t = setup()
    seedTwoProjects(t.server)
    t.answerOnce(`GET /projects/${P}/events`, (answer) => {
      const result = answer()
      if (result.kind !== 'ok') return result
      const items: unknown = read(result.body, 'items')
      if (!Array.isArray(items)) return result
      return ok({ items: [...items, { id: 'broken' }] })
    })

    await t.engine.requestSync('full')

    expect((await t.project(P)).baitSites).toEqual([])
    expect(t.errors).toEqual(['Sync download: GET of the project events returned a body that is not a valid event list.'])
    expect(t.engine.getSnapshot().lastResult).toBe('unavailable')
  })
})

// ---------------------------------------------------------------------------------------
// Engine behaviour
// ---------------------------------------------------------------------------------------

describe('engine', () => {
  test('22. phases idle -> uploading -> downloading -> idle; same snapshot object while nothing changed', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))
    const initial = t.engine.getSnapshot()
    expect(initial).toEqual({ phase: 'idle', lastResult: 'never' })
    expect(t.engine.getSnapshot()).toBe(initial)
    const phases: SyncPhase[] = []
    const listener = vi.fn(() => phases.push(t.engine.getSnapshot().phase))
    t.engine.subscribe(listener)

    await t.engine.requestSync('full')

    expect(phases).toEqual(['uploading', 'downloading', 'idle'])
    const final = t.engine.getSnapshot()
    expect(final).toEqual({ phase: 'idle', lastResult: 'synced' })
    expect(t.engine.getSnapshot()).toBe(final)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  test('22b. an unsubscribed listener is not called', async () => {
    const t = setup()
    const listener = vi.fn()
    const unsubscribe = t.engine.subscribe(listener)
    unsubscribe()

    await t.engine.requestSync('upload')

    expect(listener).not.toHaveBeenCalled()
  })

  test('23. requestSync during a pass: no parallel pass, exactly one more afterwards, every promise resolves when idle', async () => {
    const t = setup()
    seedServer(t.server, P, [])
    const gate = deferred()
    t.answerOnce('GET /projects', async (answer) => {
      await gate.promise
      return answer()
    })

    const first = t.engine.requestSync('full')
    await flush()
    expect(t.engine.getSnapshot().phase).toBe('downloading')
    const second = t.engine.requestSync('full')
    const third = t.engine.requestSync('upload')
    gate.resolve()

    const phases: SyncPhase[] = []
    for (const promise of [first, second, third]) {
      await promise
      phases.push(t.engine.getSnapshot().phase)
    }

    expect(phases).toEqual(['idle', 'idle', 'idle'])
    expect(t.routes().filter((route) => route === 'GET /projects')).toHaveLength(2)
    expect(t.overlaps()).toBe(0)
  })

  test('23b. a listener that calls requestSync joins the run instead of starting a second one', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))
    let calls = 0
    t.engine.subscribe(() => {
      if (calls++ === 0) void t.engine.requestSync('upload')
    })

    await t.engine.requestSync('upload')

    expect(t.requests).toHaveLength(1)
    expect(t.overlaps()).toBe(0)
  })

  describe('24. safety timer', () => {
    test('armed when a sendable item is left; firing it runs an upload pass; never two armed', async () => {
      const t = setup()
      seedServer(t.server, P, ['site-a'])
      await t.enqueue(recordEvent('event-1', 'site-a'))
      t.intercept(() => UNAVAILABLE)

      await t.engine.requestSync('upload')
      expect(t.manual.armed().map((timer) => timer.ms)).toEqual([60_000])

      await t.engine.requestSync('full')
      expect(t.manual.armed()).toHaveLength(1)

      t.intercept(passThrough)
      t.manual.fire()
      await flush()
      await t.engine.requestSync('upload') // Joins the pass the timer started.

      expect(await t.store.queuedItems()).toEqual([])
      expect(t.manual.armed()).toEqual([])
    })

    test('cancelled when a pass starts', async () => {
      const t = setup()
      seedServer(t.server, P, ['site-a'])
      await t.enqueue(recordEvent('event-1', 'site-a'))
      t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, UNAVAILABLE)
      await t.engine.requestSync('upload')
      expect(t.manual.armed()).toHaveLength(1)
      const gate = deferred()
      t.intercept(async (_, answer) => {
        await gate.promise
        return answer()
      })

      const done = t.engine.requestSync('upload')
      await flush()
      expect(t.manual.armed()).toEqual([])
      gate.resolve()
      await done
    })

    test('not armed with an empty queue', async () => {
      const t = setup()
      await t.engine.requestSync('upload')
      expect(t.manual.armed()).toEqual([])
    })

    test('not armed with only rejected and blocked items', async () => {
      const t = setup()
      seedServer(t.server, P, ['site-a'])
      await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a'))
      t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, problem(409, 'INVALID_EVENT_SEQUENCE'))

      await t.engine.requestSync('upload')

      expect(await t.store.queuedItems()).toHaveLength(2)
      expect(t.manual.armed()).toEqual([])
    })

    test('not armed with only an owed download', async () => {
      const t = setup()
      t.answerOnce('GET /projects', UNAVAILABLE)

      await t.engine.requestSync('full')

      expect(t.engine.getSnapshot().lastResult).toBe('unavailable')
      expect(t.manual.armed()).toEqual([])
    })

    test('cancelled on stop()', async () => {
      const t = setup()
      seedServer(t.server, P, ['site-a'])
      await t.enqueue(recordEvent('event-1', 'site-a'))
      t.intercept(() => UNAVAILABLE)
      await t.engine.requestSync('upload')
      expect(t.manual.armed()).toHaveLength(1)

      t.engine.stop()

      expect(t.manual.armed()).toEqual([])
    })
  })

  test('25. stop() during a request: nothing written, nobody notified, no timer; requestSync afterwards does nothing', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'), recordEvent('event-2', 'site-a', 'INSPECTED'))
    const gate = deferred()
    t.answerOnce(`POST /projects/${P}/bait-sites/site-a/events`, async (answer) => {
      await gate.promise
      return answer()
    })
    const done = t.engine.requestSync('full')
    await flush()
    const before = await t.store.queuedItems()
    const listener = vi.fn()
    t.engine.subscribe(listener)

    t.engine.stop()
    gate.resolve()
    await done

    expect(await t.store.queuedItems()).toBe(before)
    expect((await t.project()).events).toEqual([])
    expect(listener).not.toHaveBeenCalled()
    expect(t.manual.armed()).toEqual([])
    expect(t.requests).toHaveLength(1)

    await t.engine.requestSync('full')
    expect(t.requests).toHaveLength(1)
    expect(listener).not.toHaveBeenCalled()
  })

  test('25b. stop() during a download request: the snapshot is not written, no further request', async () => {
    const t = setup()
    seedServer(t.server, P, ['site-a'])
    const gate = deferred()
    t.answerOnce(`GET /projects/${P}/bait-sites`, async (answer) => {
      await gate.promise
      return answer()
    })
    const done = t.engine.requestSync('full')
    await flush()
    expect(t.routes().at(-1)).toBe(`GET /projects/${P}/bait-sites`)

    t.engine.stop()
    gate.resolve()
    await done

    expect(t.routes().at(-1)).toBe(`GET /projects/${P}/bait-sites`)
    expect((await t.project()).baitSites).toEqual([])
  })

  describe('25c. stop() during the last request before a download write: the write never happens', () => {
    /** Records the download writes, so a write after stop() is caught even if it changes nothing visible. */
    function recordingStore() {
      const inner = createFakeLocalStore()
      const writes: string[] = []
      const store: LocalStore = {
        ...inner,
        async replaceProjects(projects) {
          writes.push('replaceProjects')
          return inner.replaceProjects(projects)
        },
        async replaceProjectSnapshot(projectId, snapshot) {
          writes.push('replaceProjectSnapshot')
          return inner.replaceProjectSnapshot(projectId, snapshot)
        },
      }
      return { store, writes }
    }

    test('(i) GET /projects answers after stop(): replaceProjects is not called', async () => {
      const { store, writes } = recordingStore()
      const t = setup({ store })
      seedServer(t.server, P, ['site-a'])
      const gate = deferred()
      t.answerOnce('GET /projects', async (answer) => {
        await gate.promise
        return answer()
      })
      const done = t.engine.requestSync('full')
      await flush()
      expect(t.routes()).toEqual(['GET /projects'])
      const listener = vi.fn()
      t.engine.subscribe(listener)

      t.engine.stop()
      gate.resolve()
      await done
      await flush()

      expect(writes).toEqual([])
      expect((await t.projects()).projects).toEqual([])
      expect(listener).not.toHaveBeenCalled()
      expect(t.routes()).toEqual(['GET /projects'])
    })

    test('(ii) GET of the project events answers after stop(): replaceProjectSnapshot is not called', async () => {
      const { store, writes } = recordingStore()
      const t = setup({ store })
      seedServer(t.server, P, ['site-a'])
      const gate = deferred()
      t.answerOnce(`GET /projects/${P}/events`, async (answer) => {
        await gate.promise
        return answer()
      })
      const done = t.engine.requestSync('full')
      await flush()
      expect(t.routes().at(-1)).toBe(`GET /projects/${P}/events`)
      const listener = vi.fn()
      t.engine.subscribe(listener)

      t.engine.stop()
      gate.resolve()
      await done
      await flush()

      expect(writes).toEqual(['replaceProjects'])
      expect((await t.project()).baitSites).toEqual([])
      expect(listener).not.toHaveBeenCalled()
      expect(t.routes().at(-1)).toBe(`GET /projects/${P}/events`)
    })
  })

  test('26. the store throws inside confirm: error logged without its message, idle again, the next request works', async () => {
    const inner = createFakeLocalStore()
    let failures = 1
    const store: LocalStore = {
      ...inner,
      async confirm(seq, confirmation) {
        if (failures-- > 0) throw new Error('database broken at event-1')
        return inner.confirm(seq, confirmation)
      },
    }
    const t = setup({ store })
    seedServer(t.server, P, ['site-a'])
    await t.enqueue(recordEvent('event-1', 'site-a'))

    await t.engine.requestSync('upload')

    expect(t.errors).toEqual(['Sync: a pass stopped on an unexpected error.'])
    expect(t.engine.getSnapshot()).toEqual({ phase: 'idle', lastResult: 'unavailable' })

    await t.engine.requestSync('upload')

    expect(await t.store.queuedItems()).toEqual([])
    expect(t.engine.getSnapshot()).toEqual({ phase: 'idle', lastResult: 'synced' })
  })
})
