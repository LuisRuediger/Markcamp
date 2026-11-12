import type { Project } from './project'
import {
  LOADING,
  assertConfirmationMatches,
  assertSnapshotBelongsTo,
  type Confirmation,
  type Loadable,
  type LocalBaitSite,
  type LocalEvent,
  type LocalSpecies,
  type LocalStore,
  type Observable,
  type ProjectRaw,
  type ProjectsRaw,
  type QueueItem,
  type QueueRejection,
} from './localStore'

// An in-memory LocalStore with the same contract as the Dexie adapter (localStore.suite.ts
// runs against both). A normal module, not a test file: the sync engine's tests use it.
//
// The whole database is one immutable State. Every write builds the next State and swaps
// it in one assignment, after all checks: a throw leaves the old State, and no reader can
// see half a write. That is what an IndexedDB transaction gives the Dexie adapter.

interface State {
  readonly projects: ReadonlyMap<string, Project>
  readonly baitSites: ReadonlyMap<string, LocalBaitSite>
  readonly events: ReadonlyMap<string, LocalEvent>
  readonly species: readonly LocalSpecies[]
  /** In seq order. */
  readonly queue: readonly QueueItem[]
  /** Never decreases, so a seq is never reused (like an IndexedDB key generator). */
  readonly nextSeq: number
}

function byId(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

function withPut<T extends { readonly id: string }>(map: ReadonlyMap<string, T>, values: Iterable<T>): Map<string, T> {
  const next = new Map(map)
  for (const value of values) next.set(value.id, value)
  return next
}

function projectsRaw(state: State): ProjectsRaw {
  return {
    projects: [...state.projects.values()].toSorted(byId),
    queue: state.queue.filter((item) => item.payload.kind === 'createProject'),
  }
}

function projectRaw(state: State, projectId: string): ProjectRaw {
  return {
    project: state.projects.get(projectId) ?? null,
    baitSites: [...state.baitSites.values()].filter((site) => site.projectId === projectId).toSorted(byId),
    events: [...state.events.values()].filter((event) => event.projectId === projectId),
    species: state.species,
    queue: state.queue.filter((item) => item.payload.projectId === projectId),
  }
}

/** Applies a confirmation to the copy. No default branch: a new kind must be handled here. */
function applyConfirmation(state: State, confirmation: Confirmation): Pick<State, 'projects' | 'baitSites' | 'events'> {
  const { projects, baitSites, events } = state
  switch (confirmation.kind) {
    case 'projectCreated':
      return { projects: withPut(projects, [confirmation.project]), baitSites, events }
    case 'baitSiteCreated':
      return {
        projects,
        baitSites: withPut(baitSites, [confirmation.baitSite]),
        events: withPut(events, [confirmation.installed]),
      }
    case 'eventRecorded':
      return { projects, baitSites, events: withPut(events, [confirmation.event]) }
    case 'eventVoided': {
      const next = new Map(events)
      next.delete(confirmation.eventId)
      return { projects, baitSites, events: next }
    }
  }
}

export function createFakeLocalStore(): LocalStore {
  let state: State = {
    projects: new Map(),
    baitSites: new Map(),
    events: new Map(),
    species: [],
    queue: [],
    nextSeq: 1,
  }
  // One notifier per observable that has listeners.
  const notifiers = new Set<() => void>()

  function commit(next: State): void {
    state = next
    for (const notify of [...notifiers]) notify()
  }

  function updateItem(seq: number, change: (item: QueueItem) => QueueItem): void {
    if (!state.queue.some((item) => item.seq === seq)) return
    commit({ ...state, queue: state.queue.map((item) => (item.seq === seq ? change(item) : item)) })
  }

  function observe<T>(read: (current: State) => T): Observable<T> {
    const listeners = new Set<() => void>()
    let loaded = false
    let loadScheduled = false
    let cachedState: State | null = null
    let cached: Loadable<T> = LOADING

    function notify(): void {
      for (const listener of [...listeners]) listener()
    }

    return {
      subscribe(listener) {
        listeners.add(listener)
        notifiers.add(notify)
        // Like IndexedDB, the first read is asynchronous: ready on a microtask, never synchronously.
        if (!loadScheduled) {
          loadScheduled = true
          void Promise.resolve().then(() => {
            loaded = true
            notify()
          })
        }
        return () => {
          listeners.delete(listener)
          // `loaded` stays true: once ready, never loading again (StrictMode resubscribes).
          if (listeners.size === 0) notifiers.delete(notify)
        }
      },
      getSnapshot() {
        if (!loaded) return LOADING
        // A new object only when the State was swapped: same object while nothing was written.
        if (cachedState !== state) {
          cachedState = state
          cached = { status: 'ready', value: read(state) }
        }
        return cached
      },
    }
  }

  return {
    observeProjects: () => observe(projectsRaw),
    observeProject: (projectId) => observe((current) => projectRaw(current, projectId)),
    // The State's own array: it is replaced, never mutated, so handing it out is safe.
    observeQueue: () => observe((current) => current.queue),

    async enqueue(payload) {
      const item: QueueItem = { seq: state.nextSeq, payload, rejection: null }
      commit({ ...state, queue: [...state.queue, item], nextSeq: state.nextSeq + 1 })
      return item
    },

    async queuedItems() {
      return state.queue
    },

    async confirm(seq, confirmation) {
      const item = state.queue.find((candidate) => candidate.seq === seq)
      if (item === undefined) return 'itemMissing'
      // Before building the next State: a throw leaves the old one.
      assertConfirmationMatches(item, confirmation)
      // Item removed and confirmation written in the same swap (ADR 0008, decision 3).
      commit({
        ...state,
        ...applyConfirmation(state, confirmation),
        queue: state.queue.filter((candidate) => candidate.seq !== seq),
      })
      return 'confirmed'
    },

    async markRejected(seq, rejection: QueueRejection) {
      updateItem(seq, (item) => ({ ...item, rejection }))
    },

    async clearRejection(seq) {
      updateItem(seq, (item) => ({ ...item, rejection: null }))
    },

    async discard(seq) {
      if (!state.queue.some((item) => item.seq === seq)) return
      commit({ ...state, queue: state.queue.filter((item) => item.seq !== seq) })
    },

    async replaceProjects(projects) {
      commit({ ...state, projects: withPut(new Map(), projects) })
    },

    async replaceProjectSnapshot(projectId, snapshot) {
      // Before building the next State: a throw leaves the old one.
      assertSnapshotBelongsTo(projectId, snapshot)
      // The queue is never read or written here (ADR 0008, derived rule 3).
      const otherSites = [...state.baitSites.values()].filter((site) => site.projectId !== projectId)
      const otherEvents = [...state.events.values()].filter((event) => event.projectId !== projectId)
      commit({
        ...state,
        baitSites: withPut(withPut(new Map(), otherSites), snapshot.baitSites),
        events: withPut(withPut(new Map(), otherEvents), snapshot.events),
        species: [...snapshot.species],
      })
    },
  }
}
