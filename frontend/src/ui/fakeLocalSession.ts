import { vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { createProjectsView } from '../core/localMerge'
import type { LocalSession, LocalSessionSnapshot } from '../core/localSession'
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

/** A LocalSession whose snapshot the test sets; submit, retry and discard are spies (mockRejectedValue makes them reject). */
export function createFakeLocalSession(initial: LocalSessionSnapshot = { status: 'opening' }) {
  let snapshot = initial
  const { subscribe, notify } = createListeners()
  const local = {
    subscribe,
    getSnapshot: () => snapshot,
    submit: vi.fn<LocalSession['submit']>(async () => 'queued'),
    retry: vi.fn<LocalSession['retry']>(async () => {}),
    discard: vi.fn<LocalSession['discard']>(async () => {}),
  } satisfies LocalSession
  return {
    ...local,
    setSnapshot(next: LocalSessionSnapshot) {
      snapshot = next
      notify()
    },
  }
}

/** A ready local session over a fake LocalStore and the real projects view. */
export function createReadyLocalSession(store: LocalStore = createFakeLocalStore()) {
  const sync = createFakeSyncEngine()
  const projects = createProjectsView(store)
  const local = createFakeLocalSession({ status: 'ready', sync, projects })
  return { store, sync, projects, local }
}
