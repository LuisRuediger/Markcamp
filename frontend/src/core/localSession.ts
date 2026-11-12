import type { LocalAccounts } from './localAccounts'
import { createPendingCountView, createProjectsView, type ProjectListEntry } from './localMerge'
import type { LocalStore, Observable, QueuePayload } from './localStore'
import type { AppLifecycle, Logger, StoragePersistence } from './ports'
import type { SessionIdentitySource } from './sessionStore'
import type { SyncEngine } from './syncEngine'

// The local session (ADR 0008, decisions 5, 9 and 11): for every signed-in session, opens
// that user's local database and starts a sync engine over it; at the end of the session,
// stops the engine and closes the database. One LocalSession per app run (main.tsx).
//
// A store, its observables, its views and its engine belong to one session. A closed Dexie
// database makes its observables go silent without an error, so nothing is reused across
// sessions, not even for the same user signing in again.

export type LocalSessionSnapshot =
  | { readonly status: 'none' } // not signed in
  | { readonly status: 'opening' }
  | { readonly status: 'needsFirstOnline' } // first use on this device, and GET /me failed
  | { readonly status: 'failed' } // opening the database failed
  | {
      readonly status: 'ready'
      readonly sync: SyncEngine
      readonly projects: Observable<readonly ProjectListEntry[]>
      /** Queue items waiting to be sent, of every kind and project (the sync indicator). */
      readonly pendingCount: Observable<number>
    }

export type SubmitOutcome = 'queued' | 'notReady'

export interface LocalSession {
  subscribe(listener: () => void): () => void
  /** The same object (===) while nothing changed. */
  getSnapshot(): LocalSessionSnapshot
  /** The only way anything enters the queue: enqueue, then requestSync('upload'). */
  submit(payload: QueuePayload): Promise<SubmitOutcome>
  /** The user's "retry" of a rejected item: clearRejection, then requestSync('upload'). No-op when not ready. */
  retry(seq: number): Promise<void>
  /** The user's "discard". No-op when not ready. */
  discard(seq: number): Promise<void>
}

export interface LocalSessionDeps {
  readonly session: SessionIdentitySource
  readonly accounts: LocalAccounts
  /** close() never deletes anything: sign-out keeps the queue (ADR 0004). */
  readonly openStore: (userId: string) => Promise<LocalStore & { close(): void }>
  readonly createSync: (store: LocalStore) => SyncEngine
  readonly lifecycle: AppLifecycle
  readonly persistence: StoragePersistence
  readonly logger: Logger
}

type ReadySnapshot = Extract<LocalSessionSnapshot, { readonly status: 'ready' }>

// Shared objects: the same status gives the same snapshot (===).
const NONE: LocalSessionSnapshot = { status: 'none' }
const OPENING: LocalSessionSnapshot = { status: 'opening' }
const NEEDS_FIRST_ONLINE: LocalSessionSnapshot = { status: 'needsFirstOnline' }
const FAILED: LocalSessionSnapshot = { status: 'failed' }

/** An open database and its engine. */
interface Runtime {
  readonly store: LocalStore & { close(): void }
  readonly snapshot: ReadySnapshot
}

/** Everything that belongs to one session key. Replaced, never reused, when the key changes. */
interface Run {
  readonly key: number
  readonly uid: string
  /** The mapping's answer, once it came (null: no mapping, or the lookup failed). */
  lookup: { readonly userId: string | null } | null
  /** The internal id of the database open, opening or that failed to open. */
  targetId: string | null
  /** Identifies the openStore call in flight; any other value makes its result late. */
  openAttempt: object | null
  runtime: Runtime | null
  /** The last id passed to remember() in this session. */
  rememberedId: string | null
}

export function createLocalSession(deps: LocalSessionDeps): LocalSession {
  const { session, accounts, logger } = deps
  let snapshot: LocalSessionSnapshot = NONE
  const listeners = new Set<() => void>()
  let current: Run | null = null
  let persistRequested = false

  function setSnapshot(next: LocalSessionSnapshot): void {
    if (next === snapshot) return
    snapshot = next
    for (const listener of [...listeners]) listener()
  }

  /** Engine first: after stop() it writes nothing, so no answer in flight reaches a closed database. */
  function endRuntime(run: Run): void {
    run.openAttempt = null
    const { runtime } = run
    if (runtime === null) return
    run.runtime = null
    runtime.snapshot.sync.stop()
    runtime.store.close()
  }

  function requestPersistence(): void {
    if (persistRequested) return
    persistRequested = true
    // Never blocks or changes anything (ADR 0008, decision 11); only the bad outcomes are logged.
    void deps.persistence.request().then((outcome) => {
      switch (outcome) {
        case 'denied':
          logger.warn('Persistent storage was denied by the browser.')
          return
        case 'unsupported':
          logger.warn('Persistent storage is unavailable in this browser.')
          return
        case 'granted':
        case 'alreadyPersisted':
          return
      }
    })
  }

  function open(run: Run, userId: string): void {
    run.targetId = userId
    const attempt = {}
    run.openAttempt = attempt
    setSnapshot(OPENING)
    const isCurrent = () => current === run && run.openAttempt === attempt
    deps.openStore(userId).then(
      (store) => {
        // Late: another session, or another id, took over. Never exposed, never synced.
        if (!isCurrent()) {
          store.close()
          return
        }
        run.openAttempt = null
        const sync = deps.createSync(store)
        const ready: ReadySnapshot = {
          status: 'ready',
          sync,
          projects: createProjectsView(store),
          pendingCount: createPendingCountView(store),
        }
        run.runtime = { store, snapshot: ready }
        setSnapshot(ready)
        // A listener may have ended the session already.
        if (run.runtime?.snapshot !== ready) return
        void sync.requestSync('full')
        requestPersistence()
      },
      () => {
        if (!isCurrent()) return
        run.openAttempt = null
        // Never the error's message: it may carry the database name, which holds the id.
        logger.error('Local session: opening the local database failed.')
        setSnapshot(FAILED)
      },
    )
  }

  /** Moves the current session one step forward from what is known now. */
  function advance(run: Run): void {
    const identity = session.getIdentity()
    if (identity === null || current !== run) return

    // ADR 0008, decision 9: after each successful /me.
    if (identity.userId !== null && identity.userId !== run.rememberedId) {
      run.rememberedId = identity.userId
      accounts.remember(run.uid, identity.userId).catch(() => {
        logger.error('Local session: remembering the local account failed.')
      })
    }

    // /me is the truth; until it answers, the mapping lets the app open with no signal.
    const wanted = identity.userId ?? run.lookup?.userId ?? null
    if (wanted === null) {
      if (run.targetId !== null) return
      // ADR 0008: the first sign-in on a device is online.
      const firstUseOffline = run.lookup !== null && identity.backend === 'unavailable'
      setSnapshot(firstUseOffline ? NEEDS_FIRST_ONLINE : OPENING)
      return
    }
    if (wanted === run.targetId) return
    // The same uid got another id (the dev database was recreated): that runtime ends.
    endRuntime(run)
    open(run, wanted)
  }

  function startLookup(run: Run): void {
    accounts
      .userIdFor(run.uid)
      .catch(() => {
        logger.error('Local session: looking up the local account failed.')
        return null
      })
      .then((userId) => {
        // A lookup for one session never opens a database in another one.
        if (current !== run) return
        run.lookup = { userId }
        advance(run)
      })
  }

  function onSessionChanged(): void {
    const key = session.getSessionKey()
    const identity = session.getIdentity()
    if (key === null || identity === null) {
      if (current !== null) endRuntime(current)
      current = null
      setSnapshot(NONE)
      return
    }
    if (current === null || current.key !== key) {
      if (current !== null) endRuntime(current)
      const run: Run = {
        key,
        uid: identity.uid,
        lookup: null,
        targetId: null,
        openAttempt: null,
        runtime: null,
        rememberedId: null,
      }
      current = run
      startLookup(run)
    }
    advance(current)
  }

  /** Browser events act on the state at that moment; outside 'ready' they request nothing. */
  function onTrigger(kind: 'upload' | 'full'): void {
    if (snapshot.status === 'ready') void snapshot.sync.requestSync(kind)
    if (session.getIdentity()?.backend === 'unavailable') session.retryBackendCheck()
  }

  /** The runtime of the current session, or null when not ready. */
  function liveRuntime(): Runtime | null {
    return current?.runtime ?? null
  }

  session.subscribe(onSessionChanged)
  deps.lifecycle.onOnline(() => onTrigger('upload'))
  deps.lifecycle.onForeground(() => onTrigger('full'))
  onSessionChanged()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => snapshot,

    async submit(payload) {
      const runtime = liveRuntime()
      if (runtime === null) return 'notReady'
      await runtime.store.enqueue(payload)
      // Ended in the meantime: the item is in its owner's queue and goes up at their next session.
      if (liveRuntime() === runtime) void runtime.snapshot.sync.requestSync('upload')
      return 'queued'
    },

    async retry(seq) {
      const runtime = liveRuntime()
      if (runtime === null) return
      await runtime.store.clearRejection(seq)
      if (liveRuntime() === runtime) void runtime.snapshot.sync.requestSync('upload')
    },

    async discard(seq) {
      const runtime = liveRuntime()
      if (runtime === null) return
      await runtime.store.discard(seq)
    },
  }
}
