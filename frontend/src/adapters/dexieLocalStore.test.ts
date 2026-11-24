import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import type { LocalBaitSite, LocalEvent, LocalSpecies, LocalStore, Observable, ProjectRaw, QueueItem, QueuePayload } from '../core/localStore'
import type { Project } from '../core/project'
import { describeLocalStore } from '../core/localStore.suite'
import type { Logger } from '../core/ports'
import { openDexieLocalStore } from './dexieLocalStore'

const silent: Logger = { error() {}, warn() {} }

// A new database for every create() (a fresh internal id), so tests never share state.
describeLocalStore('Dexie', () => openDexieLocalStore(crypto.randomUUID(), silent))

// ---------------------------------------------------------------------------------------
// Adapter-only behaviour: what the suite cannot see through the port.
// ---------------------------------------------------------------------------------------

function recordingLogger(): Logger & { readonly errors: string[] } {
  const errors: string[] = []
  return { errors, error: (message) => errors.push(message), warn() {} }
}

/** Subscribes until the observable is ready (and the predicate holds), then unsubscribes. */
async function read<T>(observable: Observable<T>, predicate: (value: T) => boolean = () => true): Promise<T> {
  const unsubscribe = observable.subscribe(() => {})
  try {
    return await vi.waitFor(
      () => {
        const snapshot = observable.getSnapshot()
        if (snapshot.status !== 'ready' || !predicate(snapshot.value)) throw new Error('not yet')
        return snapshot.value
      },
      { timeout: 2000, interval: 5 },
    )
  } finally {
    unsubscribe()
  }
}

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

function site(id: string, projectId: string): LocalBaitSite {
  return { id, projectId, name: 'Ipe tree', latitude: -27.1, longitude: -49.1, locationAccuracyM: null, createdAt: '2026-11-01T12:00:00Z' }
}

function event(id: string, projectId: string, baitSiteId: string): LocalEvent {
  return {
    id,
    projectId,
    baitSiteId,
    type: 'INSTALLED',
    occurredAt: instant('2026-11-01T10:00:00Z'),
    speciesId: null,
    identifiedEventId: null,
    recordedAt: '2026-11-01T12:00:00Z',
  }
}

/** Writes of every kind, all into project `projectId`. */
async function writeEverything(store: LocalStore, projectId: string): Promise<void> {
  await store.replaceProjects([{ id: projectId, name: 'Farm', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
  await store.replaceProjectSnapshot(projectId, {
    baitSites: [site(`${projectId}-s1`, projectId)],
    events: [event(`${projectId}-e1`, projectId, `${projectId}-s1`)],
    species: [{ id: `${projectId}-sp`, scientificName: 'Tetragonisca angustula', commonName: 'Jatai' }],
  })
  await store.enqueue({ kind: 'createProject', projectId: `${projectId}-new`, name: 'Other farm' })
  const site2 = await store.enqueue({
    kind: 'createBaitSite',
    projectId,
    baitSiteId: `${projectId}-s2`,
    name: 'Ipe tree',
    latitude: -27.1,
    longitude: -49.1,
    locationAccuracyM: null,
    installation: { id: `${projectId}-e2`, occurredAt: instant('2026-11-01T10:00:00Z') },
  })
  await store.confirm(site2.seq, {
    kind: 'baitSiteCreated',
    baitSite: site(`${projectId}-s2`, projectId),
    installed: event(`${projectId}-e2`, projectId, `${projectId}-s2`),
  })
  const rejected = await store.enqueue({ kind: 'voidEvent', projectId, baitSiteId: `${projectId}-s1`, eventId: `${projectId}-e1` })
  await store.markRejected(rejected.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
}

const EMPTY_PROJECT: ProjectRaw = { project: null, baitSites: [], events: [], species: [], queue: [] }

// The literal version 1 stores, copied here and not imported: these tests must not follow a
// later edit of the code.
const VERSION_1_STORES = {
  projects: 'id',
  baitSites: 'id, projectId',
  events: 'id, projectId',
  species: 'id',
  queue: '++seq',
}

/** Opened without a version, Dexie reads the schema that is installed in IndexedDB. */
async function installedSchema(name: string): Promise<{ readonly version: number; readonly stores: Record<string, string> }> {
  const installed = new Dexie(name)
  await installed.open()
  const stores = Object.fromEntries(
    installed.tables.map((table) => [table.name, [table.schema.primKey, ...table.schema.indexes].map((index) => index.src).join(', ')]),
  )
  const version = installed.verno
  installed.close()
  return { version, stores }
}

describe('Dexie LocalStore adapter', () => {
  it('names the database markcamp-<userId>', async () => {
    const userId = crypto.randomUUID()
    const store = await openDexieLocalStore(userId, silent)

    const names = (await indexedDB.databases()).map((database) => database.name)

    expect(names).toContain(`markcamp-${userId}`)
    store.close()
  })

  it("isolates users by construction: neither store sees the other's data", async () => {
    const a = await openDexieLocalStore(crypto.randomUUID(), silent)
    const b = await openDexieLocalStore(crypto.randomUUID(), silent)

    await writeEverything(a, 'pa')
    await writeEverything(b, 'pb')

    for (const [store, mine, other] of [
      [a, 'pa', 'pb'],
      [b, 'pb', 'pa'],
    ] as const) {
      // Species are global within a database, so the only ones visible are this user's.
      const otherProject = await read(store.observeProject(other))
      expect({ ...otherProject, species: [] }).toEqual(EMPTY_PROJECT)
      expect(otherProject.species.map((species) => species.id)).toEqual([`${mine}-sp`])
      const projects = await read(store.observeProjects())
      expect(projects.projects.map((candidate) => candidate.id)).toEqual([mine])
      expect(projects.queue.map((item) => item.payload.projectId)).toEqual([`${mine}-new`])
      expect((await store.queuedItems()).every((item) => item.payload.projectId.startsWith(mine))).toBe(true)
    }
    a.close()
    b.close()
  })

  it("isolates the last project: user B never reads user A's", async () => {
    const a = await openDexieLocalStore(crypto.randomUUID(), silent)
    const b = await openDexieLocalStore(crypto.randomUUID(), silent)

    await a.writeLastProject('pa')

    expect(await b.readLastProject()).toBeNull()
    expect(await a.readLastProject()).toBe('pa')
    a.close()
    b.close()
  })

  it('keeps the last project after close and reopen', async () => {
    const userId = crypto.randomUUID()
    const first = await openDexieLocalStore(userId, silent)
    await first.writeLastProject('p1')
    first.close()

    const reopened = await openDexieLocalStore(userId, silent)

    expect(await reopened.readLastProject()).toBe('p1')
    reopened.close()
  })

  it('keeps the queue and the copy after close and reopen', async () => {
    const userId = crypto.randomUUID()
    const first = await openDexieLocalStore(userId, silent)
    await writeEverything(first, 'p1')
    const queueBefore = await first.queuedItems()
    const projectBefore = await read(first.observeProject('p1'))
    const projectsBefore = await read(first.observeProjects())
    first.close()

    const reopened = await openDexieLocalStore(userId, silent)

    expect(queueBefore.length).toBe(2)
    expect(await reopened.queuedItems()).toEqual(queueBefore)
    expect(await read(reopened.observeProject('p1'))).toEqual(projectBefore)
    expect(await read(reopened.observeProjects())).toEqual(projectsBefore)
    reopened.close()
  })

  it('never reuses a seq, not even across reopening the database', async () => {
    const userId = crypto.randomUUID()
    const first = await openDexieLocalStore(userId, silent)
    const one = await first.enqueue({ kind: 'createProject', projectId: 'p1', name: 'Farm' })
    const two = await first.enqueue({ kind: 'createProject', projectId: 'p2', name: 'Farm' })
    await first.discard(two.seq)
    first.close()

    const reopened = await openDexieLocalStore(userId, silent)
    const three = await reopened.enqueue({ kind: 'createProject', projectId: 'p3', name: 'Farm' })

    expect(three.seq).toBeGreaterThan(one.seq)
    expect(three.seq).toBeGreaterThan(two.seq)
    reopened.close()
  })

  // Schema lock (decision D4 of slice F2b-2). This test is supposed to fail when someone
  // edits the stores of version 1 or 2. Version 1 is frozen since its first real use on the
  // iPhone (slice F2d); version 2 is frozen from the moment it opens on the iPhone (slice
  // F4-2b). The fix for a schema change is version 3 in dexieLocalStore.ts, never editing
  // version 1 or 2 nor this test.
  it('installs exactly the version 2 schema', async () => {
    const userId = crypto.randomUUID()
    const store = await openDexieLocalStore(userId, silent)
    store.close()

    const installed = await installedSchema(`markcamp-${userId}`)

    expect(installed.version).toBe(2)
    expect(installed.stores).toEqual({ ...VERSION_1_STORES, settings: 'key' })
  })

  // The first migration with real data (slice F4-2b): a device on version 1 opens version 2.
  it('upgrades a version 1 database with data: every row stays exactly as it was', async () => {
    const userId = crypto.randomUUID()
    const name = `markcamp-${userId}`
    const projects: Project[] = [
      { id: 'p1', name: 'Farm', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' },
      { id: 'p2', name: 'Other farm', role: 'MEMBER', createdAt: '2026-11-02T12:00:00Z' },
    ]
    const baitSites = [site('p1-s1', 'p1'), site('p1-s2', 'p1')]
    const events: LocalEvent[] = [
      event('p1-e1', 'p1', 'p1-s1'),
      event('p1-e2', 'p1', 'p1-s2'),
      { ...event('p1-e3', 'p1', 'p1-s1'), type: 'CAPTURED', occurredAt: instant('2026-11-05T10:00:00Z') },
    ]
    const species: LocalSpecies[] = [{ id: 'sp1', scientificName: 'Tetragonisca angustula', commonName: 'Jatai' }]
    const payloads: QueuePayload[] = [
      { kind: 'createProject', projectId: 'p3', name: 'New farm' },
      {
        kind: 'createBaitSite',
        projectId: 'p1',
        baitSiteId: 'p1-s3',
        name: 'Ipe tree',
        latitude: -27.2,
        longitude: -49.2,
        locationAccuracyM: 7,
        installation: { id: 'p1-e4', occurredAt: instant('2026-11-06T10:00:00Z') },
      },
      {
        kind: 'recordEvent',
        projectId: 'p1',
        baitSiteId: 'p1-s1',
        eventId: 'p1-e5',
        type: 'IDENTIFIED',
        occurredAt: instant('2026-11-07T10:00:00Z'),
        speciesId: 'sp1',
        identifiedEventId: 'p1-e3',
      },
      { kind: 'voidEvent', projectId: 'p1', baitSiteId: 'p1-s2', eventId: 'p1-e2' },
    ]

    // A raw connection that knows only version 1, as the build before slice F4-2b did.
    const old = new Dexie(name)
    old.version(1).stores(VERSION_1_STORES)
    await old.open()
    await old.table('projects').bulkAdd(projects)
    await old.table('baitSites').bulkAdd(baitSites)
    await old.table('events').bulkAdd(events)
    await old.table('species').bulkAdd(species)
    const queue: QueueItem[] = []
    for (const [index, payload] of payloads.entries()) {
      const rejection = index === 2 ? { status: 409, code: 'INVALID_EVENT_SEQUENCE' } : null
      const seq: unknown = await old.table('queue').add({ payload, rejection })
      if (typeof seq !== 'number') throw new Error('seq is not a number')
      queue.push({ seq, payload, rejection })
    }
    old.close()

    const store = await openDexieLocalStore(userId, silent)

    expect(await store.queuedItems()).toEqual(queue)
    expect(await read(store.observeProjects())).toEqual({ projects, queue: [queue[0]] })
    const project = await read(store.observeProject('p1'))
    expect({ ...project, events: project.events.toSorted((x, y) => (x.id < y.id ? -1 : 1)) }).toEqual({
      project: projects[0],
      baitSites,
      events,
      species,
      queue: queue.slice(1),
    })
    expect(await store.readLastProject()).toBeNull()
    const next = await store.enqueue({ kind: 'createProject', projectId: 'p4', name: 'Farm' })
    expect(queue.every((item) => next.seq > item.seq)).toBe(true)
    store.close()

    expect((await installedSchema(name)).version).toBe(2)
  })

  // What a build from before slice F4-2b does with a version 2 database. IndexedDB never goes
  // down a version, but Dexie 4 does not fail: on VersionError it retries without a version
  // and opens the database as installed. For version 2 (a new table, no row changed) that
  // makes going back to an older build safe. If this test fails after a Dexie update, the
  // older build would see the "failed" screen instead: never serve one again.
  it('a build that knows only version 1 still opens a version 2 database, and changes nothing in it', async () => {
    const userId = crypto.randomUUID()
    const name = `markcamp-${userId}`
    const store = await openDexieLocalStore(userId, silent)
    await store.writeLastProject('p1')
    const item = await store.enqueue({ kind: 'createProject', projectId: 'p9', name: 'Farm' })
    store.close()

    const old = new Dexie(name)
    old.version(1).stores(VERSION_1_STORES)
    await old.open()
    const oldTables = old.tables.map((table) => table.name).toSorted()
    const oldQueue: unknown = await old.table('queue').toArray()
    const seq: unknown = await old.table('queue').add({ payload: { kind: 'createProject', projectId: 'p10', name: 'Farm' }, rejection: null })
    old.close()

    expect(oldTables).toEqual(Object.keys(VERSION_1_STORES).toSorted())
    expect(oldQueue).toEqual([item])
    expect(await installedSchema(name)).toEqual({ version: 2, stores: { ...VERSION_1_STORES, settings: 'key' } })
    const reopened = await openDexieLocalStore(userId, silent)
    expect(await reopened.readLastProject()).toBe('p1')
    expect((await reopened.queuedItems()).map((queued) => queued.seq)).toEqual([item.seq, seq])
    reopened.close()
  })

  // Closing the database does not do it: Dexie's liveQuery deliberately never reports a
  // DatabaseClosedError (nor an AbortError) to its observer. A querier that throws does: here
  // a queue row of a shape the code does not know (a row type changed without an upgrade).
  it('logs a failed read with a fixed phrase and keeps the last snapshot', async () => {
    const userId = crypto.randomUUID()
    const logger = recordingLogger()
    const store = await openDexieLocalStore(userId, logger)
    await store.enqueue({ kind: 'createProject', projectId: 'p1', name: 'Farm' })
    const observed = store.observeProjects()
    const unsubscribe = observed.subscribe(() => {})
    await vi.waitFor(() => expect(observed.getSnapshot().status).toBe('ready'))
    const last = observed.getSnapshot()

    // A second connection, with the schema installed on disk, writes an item without payload.
    const raw = new Dexie(`markcamp-${userId}`)
    await raw.open()
    await raw.table('queue').add({ rejection: null })

    await vi.waitFor(() => expect(logger.errors).toEqual(['Local database read failed.']))
    expect(observed.getSnapshot()).toBe(last)
    unsubscribe()
    raw.close()
    store.close()
  })
})
