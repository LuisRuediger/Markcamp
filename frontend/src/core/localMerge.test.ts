import { describe, expect, test, vi } from 'vitest'
import type { BaitSiteEventType } from './baitSiteStateMachine'
import { createFakeLocalStore } from './fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from './historyOrder'
import {
  countPending,
  createPendingCountView,
  createProjectView,
  createProjectViewCache,
  createProjectsView,
  mergeProject,
  mergeProjects,
  type BaitSiteView,
} from './localMerge'
import type {
  Loadable,
  LocalBaitSite,
  LocalEvent,
  Observable,
  ProjectRaw,
  QueueItem,
  QueuePayload,
  QueueRejection,
} from './localStore'
import type { Project } from './project'

const P = 'p-1'

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

const day = (n: number): HistoryInstant => instant(`2026-11-${String(n).padStart(2, '0')}T10:00:00Z`)

function project(id: string, name = 'Farm'): Project {
  return { id, name, role: 'MEMBER', createdAt: '2026-11-01T12:00:00Z' }
}

function site(id: string, name = 'Ipe tree'): LocalBaitSite {
  return { id, projectId: P, name, latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' }
}

function event(id: string, baitSiteId: string, type: BaitSiteEventType, occurredAt: HistoryInstant): LocalEvent {
  return {
    id,
    projectId: P,
    baitSiteId,
    type,
    occurredAt,
    speciesId: null,
    identifiedEventId: null,
    recordedAt: '2026-11-20T12:00:00Z',
  }
}

let nextSeq = 1
function item(payload: QueuePayload, rejection: QueueRejection | null = null): QueueItem {
  nextSeq += 1
  return { seq: nextSeq, payload, rejection }
}

function createSite(baitSiteId: string, installationId: string, name = 'Pending site'): QueuePayload {
  return {
    kind: 'createBaitSite',
    projectId: P,
    baitSiteId,
    name,
    latitude: -27.2,
    longitude: -49.2,
    locationAccuracyM: null,
    installation: { id: installationId, occurredAt: day(1) },
  }
}

function recordEvent(baitSiteId: string, eventId: string, type: BaitSiteEventType, occurredAt: HistoryInstant): QueuePayload {
  return { kind: 'recordEvent', projectId: P, baitSiteId, eventId, type, occurredAt, speciesId: null, identifiedEventId: null }
}

function voidEvent(baitSiteId: string, eventId: string): QueuePayload {
  return { kind: 'voidEvent', projectId: P, baitSiteId, eventId }
}

function raw(parts: Partial<ProjectRaw>): ProjectRaw {
  return { project: null, baitSites: [], events: [], species: [], queue: [], ...parts }
}

function onlySite(input: ProjectRaw): BaitSiteView {
  const sites = mergeProject(input).baitSites
  expect(sites).toHaveLength(1)
  const [first] = sites
  if (first === undefined) throw new Error('no bait site')
  return first
}

const eventIds = (view: BaitSiteView): string[] => view.events.map((candidate) => candidate.id)

describe('mergeProject', () => {
  test('a bait site only in the queue appears pending, with its INSTALLED, and replays as ARMED', () => {
    const view = onlySite(raw({ queue: [item(createSite('s-1', 'e-1'))] }))

    expect(view).toMatchObject({ id: 's-1', name: 'Pending site', createdAt: null, pending: true, rejection: null })
    expect(view.events).toEqual([
      {
        id: 'e-1',
        baitSiteId: 's-1',
        type: 'INSTALLED',
        occurredAt: day(1),
        speciesId: null,
        identifiedEventId: null,
        recordedAt: null,
        pending: true,
      },
    ])
    expect(view.replay).toEqual({ valid: true, status: 'ARMED' })
  })

  test('a pending CAPTURED on a confirmed site changes the status and is marked pending', () => {
    const view = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1))],
        queue: [item(recordEvent('s-1', 'e-2', 'CAPTURED', day(2)))],
      }),
    )

    expect(view.pending).toBe(false)
    expect(view.createdAt).toBe('2026-11-01T12:00:00Z')
    expect(view.events.map((candidate) => [candidate.id, candidate.pending])).toEqual([
      ['e-1', false],
      ['e-2', true],
    ])
    expect(view.replay).toEqual({ valid: true, status: 'CAPTURED' })
  })

  test('a retroactive pending event is sorted into history order, not appended', () => {
    const view = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1)), event('e-3', 's-1', 'CAPTURED', day(10))],
        queue: [item(recordEvent('s-1', 'e-2', 'ACTIVITY', day(5)))],
      }),
    )

    expect(eventIds(view)).toEqual(['e-1', 'e-2', 'e-3'])
    expect(view.replay).toEqual({ valid: true, status: 'CAPTURED' })
  })

  test('a pending void hides a confirmed event and the status is replayed without it', () => {
    const view = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1)), event('e-2', 's-1', 'CAPTURED', day(2))],
        queue: [item(voidEvent('s-1', 'e-2'))],
      }),
    )

    expect(eventIds(view)).toEqual(['e-1'])
    expect(view.pendingVoidEventIds).toEqual(['e-2'])
    expect(view.replay).toEqual({ valid: true, status: 'ARMED' })
  })

  test('a pending void of a pending event hides it, with both items still in the queue', () => {
    const view = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1))],
        queue: [item(recordEvent('s-1', 'e-2', 'CAPTURED', day(2))), item(voidEvent('s-1', 'e-2'))],
      }),
    )

    expect(eventIds(view)).toEqual(['e-1'])
    expect(view.pendingVoidEventIds).toEqual(['e-2'])
    expect(view.replay).toEqual({ valid: true, status: 'ARMED' })
  })

  test('the same id in the copy and in the queue gives one entry with the confirmed data, marked pending', () => {
    const view = onlySite(
      raw({
        baitSites: [site('s-1', 'Confirmed name')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1)), event('e-2', 's-1', 'ACTIVITY', day(3))],
        queue: [item(createSite('s-1', 'e-1', 'Queued name')), item(recordEvent('s-1', 'e-2', 'ACTIVITY', day(4)))],
      }),
    )

    expect(view).toMatchObject({ name: 'Confirmed name', createdAt: '2026-11-01T12:00:00Z', pending: true })
    expect(view.events).toHaveLength(2)
    expect(view.events.map((candidate) => [candidate.id, candidate.occurredAt, candidate.recordedAt, candidate.pending])).toEqual([
      ['e-1', day(1), '2026-11-20T12:00:00Z', true],
      ['e-2', day(3), '2026-11-20T12:00:00Z', true],
    ])
  })

  test('pending events and voids of a bait site that exists nowhere are left out', () => {
    const merged = mergeProject(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1))],
        queue: [item(recordEvent('s-gone', 'e-2', 'ACTIVITY', day(2))), item(voidEvent('s-gone', 'e-3'))],
      }),
    )

    expect(merged.baitSites.map((candidate) => candidate.id)).toEqual(['s-1'])
    expect(merged.baitSites[0]?.events.map((candidate) => candidate.id)).toEqual(['e-1'])
  })

  test('a rejected recordEvent gives the rejection of its own site only: seq, status, code, kind, the event', () => {
    const rejected = item(recordEvent('s-2', 'e-3', 'ACTIVITY', day(2)), { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
    const merged = mergeProject(
      raw({
        baitSites: [site('s-1'), site('s-2')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1)), event('e-2', 's-2', 'INSTALLED', day(1))],
        queue: [rejected],
      }),
    )

    expect(merged.baitSites.map((candidate) => [candidate.id, candidate.rejection])).toEqual([
      ['s-1', null],
      [
        's-2',
        {
          seq: rejected.seq,
          status: 409,
          code: 'INVALID_EVENT_SEQUENCE',
          kind: 'recordEvent',
          event: { id: 'e-3', type: 'ACTIVITY', occurredAt: day(2) },
        },
      ],
    ])
  })

  test('a rejected createBaitSite gives its INSTALLED', () => {
    const rejected = item(createSite('s-1', 'e-1'), { status: 400, code: 'VALIDATION_FAILED' })

    expect(onlySite(raw({ queue: [rejected] })).rejection).toEqual({
      seq: rejected.seq,
      status: 400,
      code: 'VALIDATION_FAILED',
      kind: 'createBaitSite',
      event: { id: 'e-1', type: 'INSTALLED', occurredAt: day(1) },
    })
  })

  test('a rejected voidEvent of a confirmed event gives that event, although the merge hides it', () => {
    const rejected = item(voidEvent('s-1', 'e-2'), { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
    const view = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1)), event('e-2', 's-1', 'CAPTURED', day(2))],
        queue: [rejected],
      }),
    )

    expect(eventIds(view)).toEqual(['e-1'])
    expect(view.rejection).toEqual({
      seq: rejected.seq,
      status: 409,
      code: 'INVALID_EVENT_SEQUENCE',
      kind: 'voidEvent',
      event: { id: 'e-2', type: 'CAPTURED', occurredAt: day(2) },
    })
  })

  test('a rejected voidEvent of a pending event gives that event; of an event found nowhere, null', () => {
    const pendingVoid = item(voidEvent('s-1', 'e-2'), { status: 500, code: null })
    const withPending = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1))],
        queue: [item(recordEvent('s-1', 'e-2', 'ACTIVITY', day(2))), pendingVoid],
      }),
    )
    expect(withPending.rejection?.event).toEqual({ id: 'e-2', type: 'ACTIVITY', occurredAt: day(2) })

    const nowhere = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1))],
        queue: [item(voidEvent('s-1', 'e-9'), { status: 500, code: null })],
      }),
    )
    expect(nowhere.rejection).toMatchObject({ kind: 'voidEvent', event: null })
  })

  test('two rejected items of one site give the lower seq', () => {
    const first = item(recordEvent('s-1', 'e-2', 'ACTIVITY', day(2)), { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
    const second = item(recordEvent('s-1', 'e-3', 'CAPTURED', day(3)), { status: 400, code: 'VALIDATION_FAILED' })
    const view = onlySite(
      raw({ baitSites: [site('s-1')], events: [event('e-1', 's-1', 'INSTALLED', day(1))], queue: [first, second] }),
    )

    expect(view.rejection?.seq).toBe(first.seq)
    expect(view.rejection?.event?.id).toBe('e-2')
  })

  test('items with no rejection give a null rejection', () => {
    const view = onlySite(
      raw({
        baitSites: [site('s-1')],
        events: [event('e-1', 's-1', 'INSTALLED', day(1))],
        queue: [item(recordEvent('s-1', 'e-2', 'ACTIVITY', day(2)))],
      }),
    )

    expect(view.rejection).toBeNull()
  })

  test('bait sites are in id order, confirmed and pending mixed', () => {
    const merged = mergeProject(
      raw({
        baitSites: [site('s-1'), site('s-3')],
        queue: [item(createSite('s-4', 'e-4')), item(createSite('s-2', 'e-2'))],
      }),
    )

    expect(merged.baitSites.map((candidate) => candidate.id)).toEqual(['s-1', 's-2', 's-3', 's-4'])
  })

  test('the project comes from the copy, or from its createProject item', () => {
    expect(mergeProject(raw({})).project).toBeNull()
    expect(mergeProject(raw({ project: project(P) })).project).toEqual({
      id: P,
      name: 'Farm',
      role: 'MEMBER',
      createdAt: '2026-11-01T12:00:00Z',
      pending: false,
      rejection: null,
    })
    const rejected = item({ kind: 'createProject', projectId: P, name: 'New' }, { status: 422, code: null })
    expect(mergeProject(raw({ queue: [rejected] })).project).toEqual({
      id: P,
      name: 'New',
      role: 'OWNER',
      createdAt: null,
      pending: true,
      rejection: { seq: rejected.seq, status: 422, code: null },
    })
  })

  test('the project of a ProjectView carries the rejection of its createProject item', () => {
    const first = item({ kind: 'createProject', projectId: P, name: 'New' })
    const second = item({ kind: 'createProject', projectId: P, name: 'New' }, { status: 400, code: 'VALIDATION_FAILED' })

    expect(mergeProject(raw({ queue: [first, second] })).project?.rejection).toEqual({
      seq: second.seq,
      status: 400,
      code: 'VALIDATION_FAILED',
    })
  })
})

describe('mergeProjects', () => {
  test('confirmed and pending projects in id order; a pending one has no date', () => {
    const rejected = item({ kind: 'createProject', projectId: 'p-4', name: 'Rejected' }, { status: 422, code: 'VALIDATION_FAILED' })
    const merged = mergeProjects({
      projects: [project('p-1'), project('p-3', 'Confirmed name')],
      queue: [
        rejected,
        item({ kind: 'createProject', projectId: 'p-2', name: 'Offline' }),
        item({ kind: 'createProject', projectId: 'p-3', name: 'Queued name' }),
      ],
    })

    expect(merged).toEqual([
      { id: 'p-1', name: 'Farm', role: 'MEMBER', createdAt: '2026-11-01T12:00:00Z', pending: false, rejection: null },
      { id: 'p-2', name: 'Offline', role: 'OWNER', createdAt: null, pending: true, rejection: null },
      { id: 'p-3', name: 'Confirmed name', role: 'MEMBER', createdAt: '2026-11-01T12:00:00Z', pending: true, rejection: null },
      {
        id: 'p-4',
        name: 'Rejected',
        role: 'OWNER',
        createdAt: null,
        pending: true,
        rejection: { seq: rejected.seq, status: 422, code: 'VALIDATION_FAILED' },
      },
    ])
  })

  test('a rejected createProject gives its seq, status and code', () => {
    const rejected = item({ kind: 'createProject', projectId: 'p-1', name: 'Farm' }, { status: 409, code: 'ID_ALREADY_EXISTS' })

    expect(mergeProjects({ projects: [], queue: [rejected] })[0]?.rejection).toEqual({
      seq: rejected.seq,
      status: 409,
      code: 'ID_ALREADY_EXISTS',
    })
  })

  test('two items for the same project, the second rejected, give the second one seq', () => {
    const first = item({ kind: 'createProject', projectId: 'p-1', name: 'Farm' })
    const second = item({ kind: 'createProject', projectId: 'p-1', name: 'Farm' }, { status: 400, code: 'VALIDATION_FAILED' })

    const [entry] = mergeProjects({ projects: [], queue: [first, second] })

    expect(entry?.rejection?.seq).toBe(second.seq)
    expect(entry?.rejection?.seq).not.toBe(first.seq)
  })

  test('two rejected items for the same project give the lower seq', () => {
    const first = item({ kind: 'createProject', projectId: 'p-1', name: 'Farm' }, { status: 400, code: 'VALIDATION_FAILED' })
    const second = item({ kind: 'createProject', projectId: 'p-1', name: 'Farm' }, { status: 500, code: null })

    expect(mergeProjects({ projects: [], queue: [first, second] })[0]?.rejection?.seq).toBe(first.seq)
  })

  test('items with no rejection give a null rejection', () => {
    const merged = mergeProjects({
      projects: [project('p-1')],
      queue: [item({ kind: 'createProject', projectId: 'p-1', name: 'Farm' }), item({ kind: 'createProject', projectId: 'p-2', name: 'New' })],
    })

    expect(merged.map((entry) => entry.rejection)).toEqual([null, null])
  })
})

describe('views cache the merge', () => {
  test('the same raw snapshot gives the same merged object; a new raw object gives a new one', () => {
    let snapshot: Loadable<ProjectRaw> = { status: 'ready', value: raw({ baitSites: [site('s-1')] }) }
    const source: Observable<ProjectRaw> = { subscribe: () => () => {}, getSnapshot: () => snapshot }
    const view = createProjectView({ ...createFakeLocalStore(), observeProject: () => source }, P)

    const first = view.getSnapshot()
    expect(first.status).toBe('ready')
    expect(view.getSnapshot()).toBe(first)

    snapshot = { status: 'ready', value: raw({ baitSites: [site('s-1'), site('s-2')] }) }
    const second = view.getSnapshot()
    expect(second).not.toBe(first)
    expect(view.getSnapshot()).toBe(second)
  })

  test('over the fake store: loading, then a stable ready object until a write', async () => {
    const store = createFakeLocalStore()
    const view = createProjectsView(store)
    expect(view.getSnapshot()).toEqual({ status: 'loading' })
    const unsubscribe = view.subscribe(() => {})

    await vi.waitFor(() => expect(view.getSnapshot().status).toBe('ready'))
    const first = view.getSnapshot()
    expect(view.getSnapshot()).toBe(first)

    await store.enqueue({ kind: 'createProject', projectId: P, name: 'Farm' })
    await vi.waitFor(() => expect(view.getSnapshot()).not.toBe(first))
    const second = view.getSnapshot()
    expect(second).toEqual({
      status: 'ready',
      value: [{ id: P, name: 'Farm', role: 'OWNER', createdAt: null, pending: true, rejection: null }],
    })
    expect(view.getSnapshot()).toBe(second)
    unsubscribe()
  })
})

describe('createProjectViewCache', () => {
  test('the same id gives the same object; different ids give different objects', () => {
    const cache = createProjectViewCache(createFakeLocalStore())

    const first = cache('p-1')
    expect(cache('p-1')).toBe(first)
    expect(cache('p-2')).not.toBe(first)
    expect(cache('p-2')).toBe(cache('p-2'))
  })

  test('the view reflects the store: a site enqueued shows up', async () => {
    const store = createFakeLocalStore()
    const view = createProjectViewCache(store)(P)
    const unsubscribe = view.subscribe(() => {})
    await vi.waitFor(() => expect(view.getSnapshot().status).toBe('ready'))

    await store.enqueue(createSite('s-1', 'e-1', 'Isca 1'))

    await vi.waitFor(() => {
      const snapshot = view.getSnapshot()
      expect(snapshot.status === 'ready' && snapshot.value.baitSites.map((candidate) => candidate.name)).toEqual(['Isca 1'])
    })
    unsubscribe()
  })
})

describe('pending count', () => {
  test('countPending counts items with no rejection, of every kind and project', () => {
    const items = [
      item({ kind: 'createProject', projectId: 'p-9', name: 'Other' }),
      item(createSite('s-1', 'e-1')),
      item(recordEvent('s-1', 'e-2', 'ACTIVITY', day(2)), { status: 409, code: 'INVALID_EVENT_SEQUENCE' }),
      // Blocked behind the rejected one, but still waiting: it counts.
      item(voidEvent('s-1', 'e-1')),
    ]

    expect(countPending(items)).toBe(3)
    expect(countPending([])).toBe(0)
  })

  test('the view: loading, then the count; the same object while the count is unchanged; a new one when it changes', async () => {
    const store = createFakeLocalStore()
    const view = createPendingCountView(store)
    expect(view.getSnapshot()).toEqual({ status: 'loading' })
    const unsubscribe = view.subscribe(() => {})

    await vi.waitFor(() => expect(view.getSnapshot()).toEqual({ status: 'ready', value: 0 }))
    const zero = view.getSnapshot()

    const first = await store.enqueue({ kind: 'createProject', projectId: 'p-1', name: 'Farm' })
    await vi.waitFor(() => expect(view.getSnapshot()).toEqual({ status: 'ready', value: 1 }))
    const one = view.getSnapshot()
    expect(one).not.toBe(zero)

    // The queue changes twice, the count does not: the same snapshot object.
    await store.markRejected(first.seq, { status: 400, code: 'VALIDATION_FAILED' })
    await store.enqueue({ kind: 'createProject', projectId: 'p-2', name: 'Farm 2' })
    expect(await store.queuedItems()).toHaveLength(2)
    expect(view.getSnapshot()).toBe(one)

    await store.discard(first.seq)
    expect(view.getSnapshot()).toBe(one)
    await store.clearRejection(first.seq)
    await store.enqueue({ kind: 'createProject', projectId: 'p-3', name: 'Farm 3' })
    await vi.waitFor(() => expect(view.getSnapshot()).toEqual({ status: 'ready', value: 2 }))
    expect(view.getSnapshot()).not.toBe(one)
    unsubscribe()
  })
})
