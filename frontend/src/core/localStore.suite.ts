import { describe, expect, it, vi } from 'vitest'
import { toHistoryInstant, type HistoryInstant } from './historyOrder'
import type { BaitSiteEventType } from './baitSiteStateMachine'
import { ConfirmationMismatchError, SnapshotMismatchError } from './localStore'
import type {
  Confirmation,
  Loadable,
  LocalBaitSite,
  LocalEvent,
  LocalSpecies,
  LocalStore,
  Observable,
  ProjectRaw,
  ProjectSnapshot,
  ProjectsRaw,
  QueueItem,
  QueuePayload,
} from './localStore'
import type { Project } from './projectsStore'

// The behaviour every LocalStore must have, written once (decision P6 of slice F2b-1).
// Run by fakeLocalStore.test.ts now and by the Dexie adapter's test in F2b-2: if the fake
// behaved differently from the real database, the sync engine's tests (which use the fake)
// would pass while the app is wrong.
//
// Not a *.test.ts file, so Vitest does not run it on its own. Every read here assumes an
// asynchronous store: it subscribes and waits for a listener call, never for a synchronous one.

const TIMEOUT_MS = 2000

// ---------------------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------------------

function show(snapshot: Loadable<unknown>): string {
  return JSON.stringify(snapshot)
}

/**
 * Subscribes and waits until getSnapshot() is ready and satisfies the predicate. Only the
 * initial check and listener calls can satisfy it: a store that changes without notifying
 * its listeners would not re-render a screen, so it fails here too.
 */
async function waitUntil<T>(observable: Observable<T>, what: string, predicate: (value: T) => boolean = () => true): Promise<T> {
  // A holder, not a `let`: TypeScript does not see assignments made inside check().
  const result: { found: { readonly value: T } | null; last: Loadable<T> } = { found: null, last: observable.getSnapshot() }
  function check(): void {
    const snapshot = observable.getSnapshot()
    result.last = snapshot
    if (result.found === null && snapshot.status === 'ready' && predicate(snapshot.value)) result.found = { value: snapshot.value }
  }
  const unsubscribe = observable.subscribe(check)
  try {
    check()
    await vi.waitFor(
      () => {
        if (result.found === null) throw new Error(`Timed out waiting for ${what}. Last snapshot: ${show(result.last)}`)
      },
      { timeout: TIMEOUT_MS, interval: 5 },
    )
  } finally {
    unsubscribe()
  }
  if (result.found === null) throw new Error(`Unreachable: waited for ${what}`)
  return result.found.value
}

/** A fresh read of what is committed now (a new observable, so nothing is cached from before). */
function readProject(store: LocalStore, projectId: string): Promise<ProjectRaw> {
  return waitUntil(store.observeProject(projectId), `project ${projectId} to be ready`)
}

function readProjects(store: LocalStore): Promise<ProjectsRaw> {
  return waitUntil(store.observeProjects(), 'projects to be ready')
}

/** Keeps every snapshot a listener sees, to check that no intermediate state was ever visible. */
function record<T>(observable: Observable<T>): { all(): readonly Loadable<T>[]; readyValues(): T[]; stop(): void } {
  const seen: Loadable<T>[] = [observable.getSnapshot()]
  const stop = observable.subscribe(() => seen.push(observable.getSnapshot()))
  return {
    all: () => [...seen],
    readyValues: () => seen.flatMap((snapshot) => (snapshot.status === 'ready' ? [snapshot.value] : [])),
    stop,
  }
}

// ---------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------

const P1 = 'p-1'
const P2 = 'p-2'

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

function project(id: string, name = 'Farm'): Project {
  return { id, name, role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }
}

function site(id: string, projectId: string, name = 'Ipe tree'): LocalBaitSite {
  return { id, projectId, name, latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' }
}

function event(id: string, projectId: string, baitSiteId: string, type: BaitSiteEventType = 'INSTALLED'): LocalEvent {
  return {
    id,
    projectId,
    baitSiteId,
    type,
    occurredAt: instant('2026-11-01T10:00:00Z'),
    speciesId: null,
    identifiedEventId: null,
    recordedAt: '2026-11-01T12:00:00Z',
  }
}

const SPECIES_A: LocalSpecies = { id: 'sp-a', scientificName: 'Tetragonisca angustula', commonName: 'Jatai' }
const SPECIES_B: LocalSpecies = { id: 'sp-b', scientificName: 'Melipona quadrifasciata', commonName: 'Mandacaia' }

function createProject(projectId: string): QueuePayload {
  return { kind: 'createProject', projectId, name: 'Farm' }
}

function createSite(projectId: string, baitSiteId: string, installationId: string): QueuePayload {
  return {
    kind: 'createBaitSite',
    projectId,
    baitSiteId,
    name: 'Ipe tree',
    latitude: -27.1,
    longitude: -49.1,
    locationAccuracyM: null,
    installation: { id: installationId, occurredAt: instant('2026-11-01T10:00:00Z') },
  }
}

function recordEvent(projectId: string, baitSiteId: string, eventId: string): QueuePayload {
  return {
    kind: 'recordEvent',
    projectId,
    baitSiteId,
    eventId,
    type: 'ACTIVITY',
    occurredAt: instant('2026-11-02T10:00:00Z'),
    speciesId: null,
    identifiedEventId: null,
  }
}

function voidEvent(projectId: string, baitSiteId: string, eventId: string): QueuePayload {
  return { kind: 'voidEvent', projectId, baitSiteId, eventId }
}

const hasSeq = (queue: readonly QueueItem[], seq: number): boolean => queue.some((item) => item.seq === seq)
const hasSite = (raw: ProjectRaw, id: string): boolean => raw.baitSites.some((candidate) => candidate.id === id)
const hasEvent = (raw: ProjectRaw, id: string): boolean => raw.events.some((candidate) => candidate.id === id)

/**
 * From the first snapshot that shows the item, every snapshot shows exactly one of "the item"
 * or "the confirmed data": never both, never neither.
 */
function expectAtomic<T>(values: readonly T[], hasItem: (value: T) => boolean, hasData: (value: T) => boolean): void {
  const start = values.findIndex(hasItem)
  expect(start, 'the item was never observed').not.toBe(-1)
  for (const value of values.slice(start)) {
    expect(hasItem(value) !== hasData(value), `intermediate state observed: ${JSON.stringify(value)}`).toBe(true)
  }
  const final = values.at(-1)
  expect(final !== undefined && hasData(final) && !hasItem(final), 'the confirmation was never observed').toBe(true)
}

// ---------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------

export function describeLocalStore(name: string, create: () => Promise<LocalStore>): void {
  describe(`LocalStore contract: ${name}`, () => {
    it('reads start loading and become ready; an empty store gives empty lists and no project', async () => {
      const store = await create()

      const projects = store.observeProjects()
      expect(projects.getSnapshot().status).toBe('loading')
      expect(await waitUntil(projects, 'projects')).toEqual({ projects: [], queue: [] })

      const one = store.observeProject(P1)
      expect(one.getSnapshot().status).toBe('loading')
      expect(await waitUntil(one, 'project')).toEqual({ project: null, baitSites: [], events: [], species: [], queue: [] })
    })

    describe('enqueue', () => {
      it('assigns an increasing seq and no rejection', async () => {
        const store = await create()
        const payload = createProject(P1)
        const first = await store.enqueue(payload)
        const second = await store.enqueue(createSite(P1, 's-1', 'e-1'))

        expect(first.payload).toEqual(payload)
        expect(first.rejection).toBeNull()
        expect(second.seq).toBeGreaterThan(first.seq)
      })

      it('never reuses a seq, not even after discarding the highest one', async () => {
        const store = await create()
        const first = await store.enqueue(createProject(P1))
        const second = await store.enqueue(createProject(P2))
        await store.discard(second.seq)
        const third = await store.enqueue(createProject('p-3'))
        expect(third.seq).toBeGreaterThan(second.seq)

        await store.discard(first.seq)
        await store.discard(third.seq)
        const fourth = await store.enqueue(createProject('p-4'))
        expect(fourth.seq).toBeGreaterThan(third.seq)
      })

      it('queuedItems returns the items of every project in seq order', async () => {
        const store = await create()
        const a = await store.enqueue(createProject(P1))
        const b = await store.enqueue(createProject(P2))
        const c = await store.enqueue(createSite(P1, 's-1', 'e-1'))
        const d = await store.enqueue(recordEvent(P2, 's-2', 'e-2'))

        expect(await store.queuedItems()).toEqual([a, b, c, d])
        expect((await readProject(store, P1)).queue).toEqual([a, c])
        expect((await readProjects(store)).queue).toEqual([a, b])
      })
    })

    describe('confirm', () => {
      it('removes a createProject item and writes the project in one step', async () => {
        const store = await create()
        const projects = store.observeProjects()
        const recorder = record(projects)
        const item = await store.enqueue(createProject(P1))
        await waitUntil(projects, 'the item', (raw) => hasSeq(raw.queue, item.seq))

        expect(await store.confirm(item.seq, { kind: 'projectCreated', project: project(P1) })).toBe('confirmed')
        await waitUntil(projects, 'the confirmation', (raw) => !hasSeq(raw.queue, item.seq))
        recorder.stop()

        expectAtomic(
          recorder.readyValues(),
          (raw) => hasSeq(raw.queue, item.seq),
          (raw) => raw.projects.some((candidate) => candidate.id === P1),
        )
        expect((await readProjects(store)).projects).toEqual([project(P1)])
      })

      it('removes a createBaitSite item and writes the site with its INSTALLED in one step', async () => {
        const store = await create()
        const observed = store.observeProject(P1)
        const recorder = record(observed)
        const item = await store.enqueue(createSite(P1, 's-1', 'e-1'))
        await waitUntil(observed, 'the item', (raw) => hasSeq(raw.queue, item.seq))

        const confirmation: Confirmation = {
          kind: 'baitSiteCreated',
          baitSite: site('s-1', P1),
          installed: event('e-1', P1, 's-1'),
        }
        expect(await store.confirm(item.seq, confirmation)).toBe('confirmed')
        await waitUntil(observed, 'the confirmation', (raw) => !hasSeq(raw.queue, item.seq))
        recorder.stop()

        const values = recorder.readyValues()
        // A site without its INSTALLED would show EMPTY: the two arrive together.
        for (const raw of values) expect(hasSite(raw, 's-1')).toBe(hasEvent(raw, 'e-1'))
        expectAtomic(values, (raw) => hasSeq(raw.queue, item.seq), (raw) => hasSite(raw, 's-1') && hasEvent(raw, 'e-1'))
        const final = await readProject(store, P1)
        expect(final.baitSites).toEqual([site('s-1', P1)])
        expect(final.events).toEqual([event('e-1', P1, 's-1')])
      })

      it('removes a recordEvent item and writes the event in one step', async () => {
        const store = await create()
        const observed = store.observeProject(P1)
        const recorder = record(observed)
        const item = await store.enqueue(recordEvent(P1, 's-1', 'e-2'))
        await waitUntil(observed, 'the item', (raw) => hasSeq(raw.queue, item.seq))

        const confirmed = event('e-2', P1, 's-1', 'ACTIVITY')
        expect(await store.confirm(item.seq, { kind: 'eventRecorded', event: confirmed })).toBe('confirmed')
        await waitUntil(observed, 'the confirmation', (raw) => !hasSeq(raw.queue, item.seq))
        recorder.stop()

        expectAtomic(recorder.readyValues(), (raw) => hasSeq(raw.queue, item.seq), (raw) => hasEvent(raw, 'e-2'))
        expect((await readProject(store, P1)).events).toEqual([confirmed])
      })

      it('removes a voidEvent item and deletes the event from the copy in one step', async () => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, {
          baitSites: [site('s-1', P1)],
          events: [event('e-1', P1, 's-1'), event('e-2', P1, 's-1', 'ACTIVITY')],
          species: [],
        })
        const observed = store.observeProject(P1)
        const recorder = record(observed)
        const item = await store.enqueue(voidEvent(P1, 's-1', 'e-2'))
        await waitUntil(observed, 'the item', (raw) => hasSeq(raw.queue, item.seq))

        expect(await store.confirm(item.seq, { kind: 'eventVoided', eventId: 'e-2' })).toBe('confirmed')
        await waitUntil(observed, 'the confirmation', (raw) => !hasSeq(raw.queue, item.seq))
        recorder.stop()

        // Here "the data" is the event being gone.
        expectAtomic(recorder.readyValues(), (raw) => hasSeq(raw.queue, item.seq), (raw) => !hasEvent(raw, 'e-2'))
        expect((await readProject(store, P1)).events).toEqual([event('e-1', P1, 's-1')])
      })

      it('overwrites the copy by id', async () => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1, 'Old name')], events: [], species: [] })
        const item = await store.enqueue(createSite(P1, 's-1', 'e-1'))

        await store.confirm(item.seq, {
          kind: 'baitSiteCreated',
          baitSite: site('s-1', P1, 'New name'),
          installed: event('e-1', P1, 's-1'),
        })

        expect((await readProject(store, P1)).baitSites).toEqual([site('s-1', P1, 'New name')])
      })

      it('returns itemMissing and writes nothing when the item is gone', async () => {
        const store = await create()
        const item = await store.enqueue(createProject(P1))
        await store.discard(item.seq)

        expect(await store.confirm(item.seq, { kind: 'projectCreated', project: project(P1) })).toBe('itemMissing')

        expect(await readProjects(store)).toEqual({ projects: [], queue: [] })
        expect(await store.queuedItems()).toEqual([])
      })

      // Each row is wrong in exactly one thing, so every check of assertConfirmationMatches
      // has a test of its own. The right pairs are the ones used by the tests above.
      const siteItem = createSite(P1, 's-1', 'e-1')
      const eventItem = recordEvent(P1, 's-1', 'e-2') // type ACTIVITY
      const mismatches: readonly [string, QueuePayload, Confirmation][] = [
        ['createProject / wrong kind', createProject(P1), { kind: 'eventRecorded', event: event('e-9', P1, 's-1') }],
        ['createProject / project.id', createProject(P1), { kind: 'projectCreated', project: project(P2) }],
        ['createBaitSite / wrong kind', siteItem, { kind: 'projectCreated', project: project(P1) }],
        ['createBaitSite / baitSite.id', siteItem, { kind: 'baitSiteCreated', baitSite: site('s-2', P1), installed: event('e-1', P1, 's-1') }],
        [
          'createBaitSite / baitSite.projectId',
          siteItem,
          { kind: 'baitSiteCreated', baitSite: site('s-1', P2), installed: event('e-1', P1, 's-1') },
        ],
        ['createBaitSite / installed.id', siteItem, { kind: 'baitSiteCreated', baitSite: site('s-1', P1), installed: event('e-2', P1, 's-1') }],
        [
          'createBaitSite / installed.baitSiteId',
          siteItem,
          { kind: 'baitSiteCreated', baitSite: site('s-1', P1), installed: event('e-1', P1, 's-2') },
        ],
        [
          'createBaitSite / installed.projectId',
          siteItem,
          { kind: 'baitSiteCreated', baitSite: site('s-1', P1), installed: event('e-1', P2, 's-1') },
        ],
        [
          'createBaitSite / installed.type',
          siteItem,
          { kind: 'baitSiteCreated', baitSite: site('s-1', P1), installed: event('e-1', P1, 's-1', 'ACTIVITY') },
        ],
        ['recordEvent / wrong kind', eventItem, { kind: 'eventVoided', eventId: 'e-2' }],
        ['recordEvent / event.id', eventItem, { kind: 'eventRecorded', event: event('e-3', P1, 's-1', 'ACTIVITY') }],
        ['recordEvent / event.baitSiteId', eventItem, { kind: 'eventRecorded', event: event('e-2', P1, 's-2', 'ACTIVITY') }],
        ['recordEvent / event.projectId', eventItem, { kind: 'eventRecorded', event: event('e-2', P2, 's-1', 'ACTIVITY') }],
        ['recordEvent / event.type', eventItem, { kind: 'eventRecorded', event: event('e-2', P1, 's-1', 'CAPTURED') }],
        [
          'voidEvent / wrong kind',
          voidEvent(P1, 's-1', 'e-1'),
          { kind: 'baitSiteCreated', baitSite: site('s-1', P1), installed: event('e-1', P1, 's-1') },
        ],
        ['voidEvent / eventId', voidEvent(P1, 's-1', 'e-1'), { kind: 'eventVoided', eventId: 'e-2' }],
      ]
      it.each(mismatches)('rejects a confirmation that does not match (%s) and changes nothing', async (_, payload, confirmation) => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1)], events: [event('e-1', P1, 's-1')], species: [] })
        const item = await store.enqueue(payload)
        const queueBefore = await store.queuedItems()
        const projectBefore = await readProject(store, P1)
        const otherBefore = await readProject(store, P2)
        const projectsBefore = await readProjects(store)

        await expect(store.confirm(item.seq, confirmation)).rejects.toThrow(ConfirmationMismatchError)

        expect(await store.queuedItems()).toStrictEqual(queueBefore)
        expect(await readProject(store, P1)).toStrictEqual(projectBefore)
        expect(await readProject(store, P2)).toStrictEqual(otherBefore)
        expect(await readProjects(store)).toStrictEqual(projectsBefore)
      })
    })

    describe('rejection and discard', () => {
      it('markRejected and clearRejection change only that item', async () => {
        const store = await create()
        const a = await store.enqueue(createSite(P1, 's-1', 'e-1'))
        const b = await store.enqueue(recordEvent(P1, 's-1', 'e-2'))

        await store.markRejected(a.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
        expect(await store.queuedItems()).toEqual([{ ...a, rejection: { status: 409, code: 'INVALID_EVENT_SEQUENCE' } }, b])

        await store.markRejected(b.seq, { status: 422, code: null })
        await store.clearRejection(a.seq)
        expect(await store.queuedItems()).toEqual([a, { ...b, rejection: { status: 422, code: null } }])
      })

      it('discard removes exactly that item, never the items that depend on it', async () => {
        const store = await create()
        const a = await store.enqueue(createSite(P1, 's-1', 'e-1'))
        const b = await store.enqueue(recordEvent(P1, 's-1', 'e-2'))
        const c = await store.enqueue(voidEvent(P1, 's-1', 'e-2'))

        await store.discard(a.seq)

        expect(await store.queuedItems()).toEqual([b, c])
        expect((await readProject(store, P1)).queue).toEqual([b, c])
      })

      it('all three are no-ops on a missing seq', async () => {
        const store = await create()
        const a = await store.enqueue(createProject(P1))
        const gone = await store.enqueue(createProject(P2))
        await store.discard(gone.seq)
        const before = await store.queuedItems()

        await store.markRejected(gone.seq, { status: 500, code: null })
        await store.clearRejection(gone.seq)
        await store.discard(gone.seq)

        expect(await store.queuedItems()).toStrictEqual(before)
        expect(before).toEqual([a])
      })
    })

    describe('replaceProjectSnapshot', () => {
      it("replaces that project's sites and events entirely, and the species", async () => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, {
          baitSites: [site('s-1', P1), site('s-2', P1)],
          events: [event('e-1', P1, 's-1'), event('e-2', P1, 's-2')],
          species: [SPECIES_A],
        })

        await store.replaceProjectSnapshot(P1, {
          baitSites: [site('s-1', P1, 'Renamed')],
          events: [event('e-3', P1, 's-1', 'ACTIVITY')],
          species: [SPECIES_B],
        })

        const raw = await readProject(store, P1)
        expect(raw.baitSites).toEqual([site('s-1', P1, 'Renamed')])
        expect(raw.events).toEqual([event('e-3', P1, 's-1', 'ACTIVITY')])
        expect(raw.species).toEqual([SPECIES_B])
      })

      it("leaves the queue exactly as it was, that project's items included", async () => {
        const store = await create()
        await store.enqueue(createProject(P1))
        const rejected = await store.enqueue(createSite(P1, 's-1', 'e-1'))
        await store.markRejected(rejected.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
        await store.enqueue(recordEvent(P1, 's-1', 'e-2'))
        await store.enqueue(voidEvent(P2, 's-9', 'e-9'))
        const before = await store.queuedItems()
        const projectQueueBefore = (await readProject(store, P1)).queue

        // The snapshot even contains the site and the event the items create.
        await store.replaceProjectSnapshot(P1, {
          baitSites: [site('s-1', P1)],
          events: [event('e-1', P1, 's-1'), event('e-2', P1, 's-1', 'ACTIVITY')],
          species: [],
        })
        await store.replaceProjectSnapshot(P1, { baitSites: [], events: [], species: [] })

        expect(await store.queuedItems()).toStrictEqual(before)
        expect((await readProject(store, P1)).queue).toStrictEqual(projectQueueBefore)
      })

      it('never touches another project', async () => {
        const store = await create()
        await store.replaceProjectSnapshot(P2, {
          baitSites: [site('s-9', P2)],
          events: [event('e-9', P2, 's-9')],
          species: [SPECIES_A],
        })
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1)], events: [event('e-1', P1, 's-1')], species: [SPECIES_A] })

        await store.replaceProjectSnapshot(P1, { baitSites: [], events: [], species: [SPECIES_A] })

        const other = await readProject(store, P2)
        expect(other.baitSites).toEqual([site('s-9', P2)])
        expect(other.events).toEqual([event('e-9', P2, 's-9')])
      })

      it('lists bait sites by id', async () => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-2', P1), site('s-1', P1), site('s-3', P1)], events: [], species: [] })

        expect((await readProject(store, P1)).baitSites.map((candidate) => candidate.id)).toEqual(['s-1', 's-2', 's-3'])
      })

      const foreignRows: readonly [string, Partial<ProjectSnapshot>][] = [
        ['a bait site', { baitSites: [site('s-1', P1), site('s-8', P2)] }],
        ['an event', { events: [event('e-1', P1, 's-1'), event('e-8', P2, 's-1')] }],
      ]
      it.each(foreignRows)('rejects a snapshot with %s of another project and changes nothing', async (_, rows) => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1)], events: [event('e-1', P1, 's-1')], species: [SPECIES_A] })
        await store.replaceProjectSnapshot(P2, { baitSites: [site('s-9', P2)], events: [event('e-9', P2, 's-9')], species: [SPECIES_A] })
        await store.enqueue(recordEvent(P1, 's-1', 'e-2'))
        const queueBefore = await store.queuedItems()
        const projectBefore = await readProject(store, P1)
        const otherBefore = await readProject(store, P2)

        const snapshot: ProjectSnapshot = { baitSites: [site('s-1', P1)], events: [], species: [SPECIES_B], ...rows }
        await expect(store.replaceProjectSnapshot(P1, snapshot)).rejects.toThrow(SnapshotMismatchError)

        expect(await store.queuedItems()).toStrictEqual(queueBefore)
        expect(await readProject(store, P1)).toStrictEqual(projectBefore)
        expect(await readProject(store, P2)).toStrictEqual(otherBefore)
      })
    })

    describe('replaceProjects', () => {
      it('replaces only the projects, in id order', async () => {
        const store = await create()
        await store.replaceProjects([project(P1, 'Old')])
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1)], events: [event('e-1', P1, 's-1')], species: [SPECIES_A] })
        const item = await store.enqueue(createProject('p-3'))

        await store.replaceProjects([project(P2), project('p-0')])

        expect(await readProjects(store)).toEqual({ projects: [project('p-0'), project(P2)], queue: [item] })
        const raw = await readProject(store, P1)
        expect(raw.project).toBeNull()
        expect(raw.baitSites).toEqual([site('s-1', P1)])
        expect(raw.events).toEqual([event('e-1', P1, 's-1')])
        expect(raw.species).toEqual([SPECIES_A])
        expect(await store.queuedItems()).toEqual([item])
      })
    })

    describe('snapshots', () => {
      it('getSnapshot returns the same object until a write changes it, then a new one', async () => {
        const store = await create()
        const observed = store.observeProject(P1)
        const recorder = record(observed)
        await waitUntil(observed, 'ready')

        const first = observed.getSnapshot()
        expect(observed.getSnapshot()).toBe(first)

        await store.enqueue(createProject(P1))
        await waitUntil(observed, 'the item', (raw) => raw.queue.length === 1)
        const second = observed.getSnapshot()
        expect(second).not.toBe(first)
        expect(observed.getSnapshot()).toBe(second)
        recorder.stop()
      })

      it('once ready, an observable stays ready after its last listener leaves and on resubscribe', async () => {
        const store = await create()
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1)], events: [], species: [] })
        const observed = store.observeProject(P1)
        // waitUntil subscribes and unsubscribes: afterwards the observable has no listener.
        await waitUntil(observed, 'ready')
        expect(observed.getSnapshot().status).toBe('ready')

        // What StrictMode does on mount: subscribe again right away.
        const recorder = record(observed)
        expect(observed.getSnapshot().status).toBe('ready')
        const item = await store.enqueue(createProject(P1))
        await waitUntil(observed, 'the item', (raw) => hasSeq(raw.queue, item.seq))
        recorder.stop()

        expect(recorder.all().every((snapshot) => snapshot.status === 'ready')).toBe(true)
      })

      it('observeProject never contains data or items of another project', async () => {
        const store = await create()
        const observed = store.observeProject(P1)
        const recorder = record(observed)

        await store.replaceProjects([project(P1), project(P2)])
        await store.replaceProjectSnapshot(P2, { baitSites: [site('s-9', P2)], events: [event('e-9', P2, 's-9')], species: [] })
        await store.enqueue(createProject(P2))
        const other = await store.enqueue(recordEvent(P2, 's-9', 'e-10'))
        await store.confirm(other.seq, { kind: 'eventRecorded', event: event('e-10', P2, 's-9', 'ACTIVITY') })
        await store.replaceProjectSnapshot(P1, { baitSites: [site('s-1', P1)], events: [event('e-1', P1, 's-1')], species: [] })
        const mine = await store.enqueue(recordEvent(P1, 's-1', 'e-2'))
        await waitUntil(observed, 'the last write', (raw) => hasSeq(raw.queue, mine.seq))
        recorder.stop()

        const values = recorder.readyValues()
        expect(values.length).toBeGreaterThan(0)
        for (const raw of values) {
          expect(raw.project === null || raw.project.id === P1).toBe(true)
          expect(raw.baitSites.every((candidate) => candidate.projectId === P1)).toBe(true)
          expect(raw.events.every((candidate) => candidate.projectId === P1)).toBe(true)
          expect(raw.queue.every((item) => item.payload.projectId === P1)).toBe(true)
        }
      })
    })
  })
}
