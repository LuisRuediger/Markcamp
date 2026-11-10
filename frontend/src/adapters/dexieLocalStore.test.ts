import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { describe, expect, it, vi } from 'vitest'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import type { LocalBaitSite, LocalEvent, LocalStore, Observable, ProjectRaw } from '../core/localStore'
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
  // edits the stores of version 1. Until the first real use on the iPhone (slice F2d) the
  // edit may be deliberate: change the expected strings here too. After F2d the fix is a
  // new schema version in dexieLocalStore.ts, never editing version 1 nor this test.
  it('installs exactly the version 1 schema', async () => {
    const userId = crypto.randomUUID()
    const store = await openDexieLocalStore(userId, silent)
    store.close()

    // Opened without a version, Dexie reads the schema that is installed in IndexedDB.
    const installed = new Dexie(`markcamp-${userId}`)
    await installed.open()
    const stores = Object.fromEntries(
      installed.tables.map((table) => [table.name, [table.schema.primKey, ...table.schema.indexes].map((index) => index.src).join(', ')]),
    )
    const version = installed.verno
    installed.close()

    expect(version).toBe(1)
    expect(stores).toEqual({
      projects: 'id',
      baitSites: 'id, projectId',
      events: 'id, projectId',
      species: 'id',
      queue: '++seq',
    })
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
