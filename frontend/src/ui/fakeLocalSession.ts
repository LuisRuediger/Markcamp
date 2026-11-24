import { vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { createPendingCountView, createProjectViewCache, createProjectsView } from '../core/localMerge'
import { createLastProjectView, type LocalSession, type LocalSessionSnapshot } from '../core/localSession'
import type { LocalStore } from '../core/localStore'
import type { SyncEngine, SyncStatus } from '../core/syncEngine'

// Test helpers. Screens get real pieces where cheap: the fake LocalStore and the real merge
// view, so pending and rejected rows come from the same code as in the app.

function createListeners() {
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A SyncEngine whose status the test sets; requestSync records every kind. */
export function createFakeSyncEngine(initial: SyncStatus = { phase: 'idle', lastResult: 'synced' }) {
  let status = initial
  const { subscribe, notify } = createListeners()
  const engine = {
    subscribe,
    getSnapshot: () => status,
    requestSync: vi.fn<SyncEngine['requestSync']>(async () => {}),
    stop: vi.fn<SyncEngine['stop']>(() => {}),
  } satisfies SyncEngine
  return {
    ...engine,
    setStatus(next: SyncStatus) {
      status = next
      notify()
    },
  }
}

/** A LocalSession whose snapshot the test sets; submit, retry, discard and rememberProject are spies (mockRejectedValue makes them reject). */
export function createFakeLocalSession(initial: LocalSessionSnapshot = { status: 'opening' }) {
  let snapshot = initial
  const { subscribe, notify } = createListeners()
  const local = {
    subscribe,
    getSnapshot: () => snapshot,
    submit: vi.fn<LocalSession['submit']>(async () => 'queued'),
    retry: vi.fn<LocalSession['retry']>(async () => {}),
    discard: vi.fn<LocalSession['discard']>(async () => {}),
    rememberProject: vi.fn<LocalSession['rememberProject']>(async () => {}),
  } satisfies LocalSession
  return {
    ...local,
    setSnapshot(next: LocalSessionSnapshot) {
      snapshot = next
      notify()
    },
  }
}

/**
 * A ready local session over a fake LocalStore and the real projects, pending count, project
 * and last project views. The last project is read here, once: write it to the store before.
 */
export function createReadyLocalSession(store: LocalStore = createFakeLocalStore()) {
  const sync = createFakeSyncEngine()
  const projects = createProjectsView(store)
  const pendingCount = createPendingCountView(store)
  const project = createProjectViewCache(store)
  const lastProjectId = createLastProjectView(store.readLastProject(), () => {})
  const local = createFakeLocalSession({ status: 'ready', sync, projects, pendingCount, project, lastProjectId })
  return { store, sync, projects, pendingCount, project, lastProjectId, local }
}
