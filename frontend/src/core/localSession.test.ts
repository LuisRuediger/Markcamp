import { describe, expect, test, vi } from 'vitest'
import { createFakeLocalAccounts } from './fakeLocalAccounts'
import { createFakeLocalStore } from './fakeLocalStore'
import type { LocalAccounts } from './localAccounts'
import { createLocalSession, type LocalSessionDeps, type LocalSessionSnapshot } from './localSession'
import type { LocalStore, QueuePayload } from './localStore'
import type { AppLifecycle, Logger, PersistOutcome, StoragePersistence } from './ports'
import type { BackendState, SessionIdentity, SessionIdentitySource } from './sessionStore'
import type { SyncEngine, SyncStatus } from './syncEngine'

// ---------------------------------------------------------------------------------------
// Fakes. Every one settles on microtasks: no timers, no IndexedDB.
// ---------------------------------------------------------------------------------------

const UID_A = 'uid-a-secret'
const UID_B = 'uid-b-secret'
const ID_A = 'user-id-a'
const ID_A2 = 'user-id-a-recreated'
const ID_B = 'user-id-b'

async function flush(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

/** The session store as the local session sees it, driven by the test. */
function createFakeSession() {
  let key: number | null = null
  let identity: SessionIdentity | null = null
  let nextKey = 1
  const listeners = new Set<() => void>()
  const retryBackendCheck = vi.fn<() => void>()

  function set(nextKeyValue: number | null, nextIdentity: SessionIdentity | null): void {
    key = nextKeyValue
    identity = nextIdentity
    for (const listener of [...listeners]) listener()
  }
  function withIdentity(change: Partial<SessionIdentity>): void {
    if (identity === null) throw new Error('fake session: not signed in')
    set(key, { ...identity, ...change })
  }

  const source: SessionIdentitySource = {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSessionKey: () => key,
    getIdentity: () => identity,
    retryBackendCheck,
  }

  return {
    source,
    retryBackendCheck,
    signIn(uid: string) {
      set(nextKey++, { uid, userId: null, backend: 'checking' })
    },
    signOut() {
      set(null, null)
    },
    meOk(userId: string) {
      withIdentity({ userId, backend: 'ok' })
    },
    backend(backend: BackendState) {
      withIdentity({ backend })
    },
  }
}

type FakeDb = LocalStore & { close: ReturnType<typeof vi.fn<() => void>> }

/** openStore controlled by the test: every call waits until the test resolves or rejects it. */
function createOpener(log: string[]) {
  const calls: {
    readonly userId: string
    readonly resolve: () => FakeDb
    readonly reject: (error: unknown) => void
  }[] = []
  let auto = false

  function openStore(userId: string): Promise<FakeDb> {
    log.push(`open ${userId}`)
    const pending = deferred<FakeDb>()
    const resolve = () => {
      const db: FakeDb = {
        ...createFakeLocalStore(),
        close: vi.fn(() => {
          log.push(`close ${userId}`)
        }),
      }
      pending.resolve(db)
      return db
    }
    calls.push({ userId, resolve, reject: pending.reject })
    if (auto) resolve()
    return pending.promise
  }

  return {
    openStore,
    calls,
    ids: () => calls.map((call) => call.userId),
    /** From now on every open resolves at once. */
    autoResolve() {
      auto = true
    },
  }
}

type SyncKind = Parameters<SyncEngine['requestSync']>[0]

interface EngineRecord {
  readonly engine: SyncEngine
  readonly store: LocalStore
  readonly requests: SyncKind[]
  /** Requests that reached the engine after stop(): must stay empty. */
  readonly afterStop: SyncKind[]
  readonly stopped: () => boolean
}

/** A recording SyncEngine: requests (with their kind) and stop. */
function createEngines(log: string[]) {
  const engines: EngineRecord[] = []

  function createSync(store: LocalStore): SyncEngine {
    const status: SyncStatus = { phase: 'idle', lastResult: 'never' }
    const requests: SyncKind[] = []
    const afterStop: SyncKind[] = []
    let stopped = false
    const engine: SyncEngine = {
      subscribe: () => () => {},
      getSnapshot: () => status,
      async requestSync(kind) {
        log.push(`sync ${kind}`)
        requests.push(kind)
        if (stopped) afterStop.push(kind)
      },
      stop() {
        log.push('stop')
        stopped = true
      },
    }
    engines.push({ engine, store, requests, afterStop, stopped: () => stopped })
    return engine
  }

  return { createSync, engines }
}

function createFakeLifecycle() {
  const online = new Set<() => void>()
  const foreground = new Set<() => void>()
  const lifecycle: AppLifecycle = {
    onOnline(listener) {
      online.add(listener)
      return () => online.delete(listener)
    },
    onForeground(listener) {
      foreground.add(listener)
      return () => foreground.delete(listener)
    },
  }
  return {
    lifecycle,
    fireOnline: () => [...online].forEach((listener) => listener()),
    fireForeground: () => [...foreground].forEach((listener) => listener()),
  }
}

function setup(options: { accounts?: LocalAccounts; persist?: PersistOutcome } = {}) {
  const log: string[] = []
  const session = createFakeSession()
  const accounts = options.accounts ?? createFakeLocalAccounts()
  const opener = createOpener(log)
  const { createSync, engines } = createEngines(log)
  const lifecycle = createFakeLifecycle()
  const persistence = { request: vi.fn<StoragePersistence['request']>(async () => options.persist ?? 'granted') }
  const errors: string[] = []
  const warnings: string[] = []
  const logger: Logger = { error: (message) => errors.push(message), warn: (message) => warnings.push(message) }
  const deps: LocalSessionDeps = {
    session: session.source,
    accounts,
    openStore: opener.openStore,
    createSync,
    lifecycle: lifecycle.lifecycle,
    persistence,
    logger,
  }
  const local = createLocalSession(deps)
  const statuses: LocalSessionSnapshot['status'][] = []
  local.subscribe(() => statuses.push(local.getSnapshot().status))

  return {
    log,
    session,
    accounts,
    opener,
    engines,
    lifecycle,
    persistence,
    errors,
    warnings,
    local,
    statuses,
    status: () => local.getSnapshot().status,
  }
}

/** Accounts that remember what the test asks, with a spy on remember. */
function accountsWith(entries: Record<string, string> = {}) {
  const inner = createFakeLocalAccounts()
  for (const [uid, userId] of Object.entries(entries)) void inner.remember(uid, userId)
  const remember = vi.fn<LocalAccounts['remember']>((uid, userId) => inner.remember(uid, userId))
  const userIdFor = vi.fn<LocalAccounts['userIdFor']>((uid) => inner.userIdFor(uid))
  return { userIdFor, remember, inner }
}

const PROJECT: QueuePayload = { kind: 'createProject', projectId: 'project-1', name: 'Sítio' }

/** Signed in as A with a known mapping and the database open. */
async function readyAsA(options: { persist?: PersistOutcome } = {}) {
  const t = setup({ accounts: accountsWith({ [UID_A]: ID_A }), ...options })
  t.opener.autoResolve()
  t.session.signIn(UID_A)
  await flush()
  expect(t.status()).toBe('ready')
  return t
}

async function queueOf(store: LocalStore) {
  return store.queuedItems()
}

// ---------------------------------------------------------------------------------------

describe('opening', () => {
  test('1. not signed in: none; no lookup, no open', async () => {
    const accounts = accountsWith()
    const t = setup({ accounts })
    await flush()

    expect(t.status()).toBe('none')
    expect(accounts.userIdFor).not.toHaveBeenCalled()
    expect(t.opener.calls).toEqual([])
  })

  test('2. a known mapping opens the mapped database before /me answers; full sync once', async () => {
    const t = setup({ accounts: accountsWith({ [UID_A]: ID_A }) })

    t.session.signIn(UID_A)
    expect(t.status()).toBe('opening')
    await flush()
    expect(t.opener.ids()).toEqual([ID_A])

    const db = t.opener.calls[0]!.resolve()
    await flush()

    // /me never answered: the identity is still checking.
    const snapshot = t.local.getSnapshot()
    expect(snapshot.status).toBe('ready')
    expect(t.engines).toHaveLength(1)
    expect(t.engines[0]!.store).toBe(db)
    expect(snapshot.status === 'ready' && snapshot.sync).toBe(t.engines[0]!.engine)
    expect(t.engines[0]!.requests).toEqual(['full'])
  })

  test('3. no mapping, /me ok: opens the /me id and remembers it', async () => {
    const accounts = accountsWith()
    const t = setup({ accounts })
    t.opener.autoResolve()

    t.session.signIn(UID_A)
    await flush()
    expect(t.status()).toBe('opening')
    expect(t.opener.calls).toEqual([])

    t.session.meOk(ID_A)
    await flush()

    expect(t.opener.ids()).toEqual([ID_A])
    expect(accounts.remember).toHaveBeenCalledExactlyOnceWith(UID_A, ID_A)
    expect(t.status()).toBe('ready')
  })

  test('4. no mapping: opening while /me is checking, needsFirstOnline when it is unavailable', async () => {
    const t = setup()

    t.session.signIn(UID_A)
    await flush()
    expect(t.status()).toBe('opening')

    t.session.backend('unavailable')
    expect(t.status()).toBe('needsFirstOnline')
    expect(t.opener.calls).toEqual([])
  })

  test.each(['online', 'foreground'] as const)(
    '5. from needsFirstOnline, %s retries /me; /me ok then opens',
    async (event) => {
      const t = setup()
      t.opener.autoResolve()
      t.session.signIn(UID_A)
      await flush()
      t.session.backend('unavailable')
      expect(t.status()).toBe('needsFirstOnline')

      if (event === 'online') t.lifecycle.fireOnline()
      else t.lifecycle.fireForeground()
      expect(t.session.retryBackendCheck).toHaveBeenCalledOnce()

      t.session.backend('checking')
      expect(t.status()).toBe('opening')
      t.session.meOk(ID_A)
      await flush()

      expect(t.status()).toBe('ready')
      expect(t.opener.ids()).toEqual([ID_A])
    },
  )

  test('6. mapping id differs from the /me id: stop, close, then open the /me database; remember overwrites', async () => {
    const accounts = accountsWith({ [UID_A]: ID_A })
    const t = setup({ accounts })
    t.opener.autoResolve()
    t.session.signIn(UID_A)
    await flush()
    expect(t.status()).toBe('ready')
    const first = t.engines[0]!

    t.session.meOk(ID_A2)
    await flush()

    expect(t.log).toEqual([`open ${ID_A}`, 'sync full', 'stop', `close ${ID_A}`, `open ${ID_A2}`, 'sync full'])
    expect(t.status()).toBe('ready')
    expect(t.engines).toHaveLength(2)
    expect(accounts.remember).toHaveBeenCalledExactlyOnceWith(UID_A, ID_A2)
    expect(await accounts.inner.userIdFor(UID_A)).toBe(ID_A2)

    t.lifecycle.fireOnline()
    t.lifecycle.fireForeground()
    await t.local.submit(PROJECT)
    expect(first.afterStop).toEqual([])
    expect(first.requests).toEqual(['full'])
  })
})

describe('end of session', () => {
  test('7. sign-out while ready: stop before close; none; online afterwards reaches no engine', async () => {
    const t = await readyAsA()
    const engine = t.engines[0]!

    t.session.signOut()

    expect(t.log.slice(-2)).toEqual(['stop', `close ${ID_A}`])
    expect(t.status()).toBe('none')
    t.lifecycle.fireOnline()
    t.lifecycle.fireForeground()
    expect(engine.afterStop).toEqual([])
    expect(engine.requests).toEqual(['full'])
  })

  test('8. sign-out while openStore is pending: its store is closed at once, no engine, never ready', async () => {
    const t = setup({ accounts: accountsWith({ [UID_A]: ID_A }) })
    t.session.signIn(UID_A)
    await flush()
    expect(t.opener.calls).toHaveLength(1)

    t.session.signOut()
    const db = t.opener.calls[0]!.resolve()
    await flush()

    expect(db.close).toHaveBeenCalledOnce()
    expect(t.engines).toEqual([])
    expect(t.status()).toBe('none')
    expect(t.statuses).not.toContain('ready')
  })

  test('9. account switch during a pending lookup: A\'s database is never opened, B\'s is', async () => {
    const inner = accountsWith({ [UID_A]: ID_A, [UID_B]: ID_B })
    const heldA = deferred<void>()
    const accounts: LocalAccounts = {
      async userIdFor(uid) {
        if (uid === UID_A) await heldA.promise
        return inner.userIdFor(uid)
      },
      remember: inner.remember,
    }
    const t = setup({ accounts })
    t.opener.autoResolve()

    t.session.signIn(UID_A)
    await flush()
    t.session.signIn(UID_B)
    await flush()
    heldA.resolve()
    await flush()

    expect(t.opener.ids()).toEqual([ID_B])
    expect(t.status()).toBe('ready')
    expect(t.engines.map((engine) => engine.store)).toHaveLength(1)
  })

  test('9b. account switch with A\'s openStore pending: A\'s store is closed and never exposed', async () => {
    const t = setup({ accounts: accountsWith({ [UID_A]: ID_A, [UID_B]: ID_B }) })
    t.session.signIn(UID_A)
    await flush()
    expect(t.opener.ids()).toEqual([ID_A])

    t.session.signIn(UID_B)
    await flush()
    const dbB = t.opener.calls[1]!.resolve()
    await flush()
    const dbA = t.opener.calls[0]!.resolve()
    await flush()

    expect(dbA.close).toHaveBeenCalledOnce()
    expect(dbB.close).not.toHaveBeenCalled()
    expect(t.engines.map((engine) => engine.store)).toEqual([dbB])
    expect(t.status()).toBe('ready')
  })

  test('10. sign-out then sign-in of the same user: a new store and a new engine; the old ones stopped and closed', async () => {
    const t = await readyAsA()
    const firstDb = t.engines[0]!.store
    const firstSnapshot = t.local.getSnapshot()

    t.session.signOut()
    t.session.signIn(UID_A)
    await flush()

    expect(t.status()).toBe('ready')
    expect(t.engines).toHaveLength(2)
    expect(t.engines[0]!.stopped()).toBe(true)
    expect(t.engines[1]!.engine).not.toBe(t.engines[0]!.engine)
    expect(t.engines[1]!.store).not.toBe(firstDb)
    expect(t.local.getSnapshot()).not.toBe(firstSnapshot)
    expect(t.log.filter((entry) => entry.startsWith('close'))).toEqual([`close ${ID_A}`])
  })
})

describe('failures', () => {
  test('11. openStore rejects: failed, fixed phrase without the error message; a later session opens', async () => {
    const t = setup({ accounts: accountsWith({ [UID_A]: ID_A }) })
    t.session.signIn(UID_A)
    await flush()

    t.opener.calls[0]!.reject(new Error(`cannot open markcamp-${ID_A}`))
    await flush()

    expect(t.status()).toBe('failed')
    expect(t.errors).toEqual(['Local session: opening the local database failed.'])
    expect(t.engines).toEqual([])

    t.opener.autoResolve()
    t.session.signOut()
    t.session.signIn(UID_A)
    await flush()
    expect(t.status()).toBe('ready')
  })

  test('12. userIdFor rejects: behaves as no mapping, error logged', async () => {
    const accounts: LocalAccounts = {
      userIdFor: async () => {
        throw new Error('broken')
      },
      remember: async () => {},
    }
    const t = setup({ accounts })
    t.opener.autoResolve()
    t.session.signIn(UID_A)
    await flush()

    expect(t.errors).toEqual(['Local session: looking up the local account failed.'])
    t.session.backend('unavailable')
    expect(t.status()).toBe('needsFirstOnline')
    t.session.meOk(ID_A)
    await flush()
    expect(t.status()).toBe('ready')
  })

  test('12b. remember rejects: error logged, state unchanged', async () => {
    const accounts: LocalAccounts = {
      userIdFor: async () => ID_A,
      remember: async () => {
        throw new Error('broken')
      },
    }
    const t = setup({ accounts })
    t.opener.autoResolve()
    t.session.signIn(UID_A)
    await flush()
    const ready = t.local.getSnapshot()

    t.session.meOk(ID_A)
    await flush()

    expect(t.errors).toEqual(['Local session: remembering the local account failed.'])
    expect(t.local.getSnapshot()).toBe(ready)
    expect(t.opener.ids()).toEqual([ID_A])
  })
})

describe('triggers', () => {
  test('13. when ready: online -> upload, foreground -> full', async () => {
    const t = await readyAsA()
    const engine = t.engines[0]!

    t.lifecycle.fireOnline()
    t.lifecycle.fireForeground()

    expect(engine.requests).toEqual(['full', 'upload', 'full'])
    // /me is checking, not unavailable: no retry.
    expect(t.session.retryBackendCheck).not.toHaveBeenCalled()
  })

  test('13b. no request and no throw in none, opening, needsFirstOnline and failed', async () => {
    const t = setup({ accounts: accountsWith({ [UID_B]: ID_B }) })
    const fire = () => {
      t.lifecycle.fireOnline()
      t.lifecycle.fireForeground()
    }

    fire() // none
    t.session.signIn(UID_A)
    fire() // opening
    await flush()
    t.session.backend('unavailable')
    expect(t.status()).toBe('needsFirstOnline')
    fire()
    t.session.signIn(UID_B)
    await flush()
    t.opener.calls[0]!.reject(new Error('broken'))
    await flush()
    expect(t.status()).toBe('failed')
    fire()

    expect(t.engines).toEqual([])
  })

  test('13c. ready with /me unavailable (opened offline): the trigger syncs and retries /me', async () => {
    const t = await readyAsA()
    t.session.backend('unavailable')

    t.lifecycle.fireOnline()

    expect(t.engines[0]!.requests).toEqual(['full', 'upload'])
    expect(t.session.retryBackendCheck).toHaveBeenCalledOnce()
  })
})

describe('storage persistence', () => {
  test('14. requested once, at the first ready; not again after sign-out and sign-in', async () => {
    const t = await readyAsA()
    expect(t.persistence.request).toHaveBeenCalledOnce()

    t.session.signOut()
    t.session.signIn(UID_A)
    await flush()

    expect(t.status()).toBe('ready')
    expect(t.persistence.request).toHaveBeenCalledOnce()
  })

  test.each([
    ['denied', ['Persistent storage was denied by the browser.']],
    ['unsupported', ['Persistent storage is unavailable in this browser.']],
    ['granted', []],
    ['alreadyPersisted', []],
  ] as const)('14b. %s logs %j', async (persist, warnings) => {
    const t = await readyAsA({ persist })
    await flush()

    expect(t.warnings).toEqual(warnings)
    expect(t.errors).toEqual([])
  })
})

describe('writes', () => {
  test('15. submit when ready: enqueued, then upload requested; queued', async () => {
    const t = await readyAsA()
    const { store, requests } = t.engines[0]!

    await expect(t.local.submit(PROJECT)).resolves.toBe('queued')

    expect((await queueOf(store)).map((item) => item.payload)).toEqual([PROJECT])
    expect(requests).toEqual(['full', 'upload'])
  })

  test("15e. the ready snapshot's pendingCount reflects the store's queue", async () => {
    const t = await readyAsA()
    const { store } = t.engines[0]!
    const snapshot = t.local.getSnapshot()
    if (snapshot.status !== 'ready') throw new Error('not ready')
    const { pendingCount } = snapshot
    const unsubscribe = pendingCount.subscribe(() => {})

    await vi.waitFor(() => expect(pendingCount.getSnapshot()).toEqual({ status: 'ready', value: 0 }))
    await t.local.submit(PROJECT)
    await store.enqueue({ kind: 'voidEvent', projectId: 'project-1', baitSiteId: 's-1', eventId: 'e-1' })
    await vi.waitFor(() => expect(pendingCount.getSnapshot()).toEqual({ status: 'ready', value: 2 }))
    unsubscribe()
  })

  test('15b. submit when not ready: notReady, nothing enqueued', async () => {
    const t = setup({ accounts: accountsWith({ [UID_A]: ID_A }) })
    await expect(t.local.submit(PROJECT)).resolves.toBe('notReady')
    t.session.signIn(UID_A)
    await flush()
    await expect(t.local.submit(PROJECT)).resolves.toBe('notReady')

    const db = t.opener.calls[0]!.resolve()
    await flush()
    expect(await queueOf(db)).toEqual([])
  })

  test('15c. retry clears the rejection and requests upload; discard removes the item with no request', async () => {
    const t = await readyAsA()
    const { store, requests } = t.engines[0]!
    const item = await store.enqueue(PROJECT)
    await store.markRejected(item.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })

    await t.local.retry(item.seq)
    expect((await queueOf(store))[0]!.rejection).toBeNull()
    expect(requests).toEqual(['full', 'upload'])

    await t.local.discard(item.seq)
    expect(await queueOf(store)).toEqual([])
    expect(requests).toEqual(['full', 'upload'])
  })

  test('15d. the session ends while enqueue is in flight: the item stays in that queue, the stopped engine is not called', async () => {
    const t = await readyAsA()
    const { store } = t.engines[0]!
    const outcome = t.local.submit(PROJECT)

    t.session.signOut()

    await expect(outcome).resolves.toBe('queued')
    expect((await queueOf(store)).map((item) => item.payload)).toEqual([PROJECT])
    expect(t.engines[0]!.afterStop).toEqual([])
  })
})

describe('snapshot', () => {
  test('16. same object between changes; listeners called on each change only; unsubscribe works', async () => {
    const t = setup({ accounts: accountsWith({ [UID_A]: ID_A }) })
    const none = t.local.getSnapshot()
    expect(t.local.getSnapshot()).toBe(none)
    const listener = vi.fn()
    const unsubscribe = t.local.subscribe(listener)

    t.session.signIn(UID_A)
    expect(listener).toHaveBeenCalledOnce() // none -> opening
    const opening = t.local.getSnapshot()
    t.session.backend('ok') // nothing changes for the local session
    await flush()
    expect(t.local.getSnapshot()).toBe(opening)
    expect(listener).toHaveBeenCalledOnce()

    t.opener.calls[0]!.resolve()
    await flush()
    expect(listener).toHaveBeenCalledTimes(2) // opening -> ready
    const ready = t.local.getSnapshot()
    t.lifecycle.fireOnline()
    expect(t.local.getSnapshot()).toBe(ready)

    unsubscribe()
    t.session.signOut()
    expect(listener).toHaveBeenCalledTimes(2)
    expect(t.statuses).toEqual(['opening', 'ready', 'none'])
  })
})

describe('privacy', () => {
  test('17. no log message contains the uid or an internal id', async () => {
    const inner = accountsWith({ [UID_A]: ID_A })
    let failLookup = true
    const accounts: LocalAccounts = {
      async userIdFor(uid) {
        if (failLookup) throw new Error(`lookup failed for ${uid}`)
        return inner.userIdFor(uid)
      },
      async remember(uid, userId) {
        throw new Error(`remember failed for ${uid} -> ${userId}`)
      },
    }
    const t = setup({ accounts, persist: 'denied' })

    // Lookup fails, /me answers, remember fails, the open fails.
    t.session.signIn(UID_A)
    await flush()
    t.session.meOk(ID_A)
    await flush()
    t.opener.calls[0]!.reject(new Error(`cannot open markcamp-${ID_A} for ${UID_A}`))
    await flush()

    // Lookup works, the open works, /me answers with another id, the persist outcome is logged.
    failLookup = false
    t.opener.autoResolve()
    t.session.signOut()
    t.session.signIn(UID_A)
    await flush()
    t.session.meOk(ID_A2)
    await flush()

    expect(t.errors).toEqual([
      'Local session: looking up the local account failed.',
      'Local session: remembering the local account failed.',
      'Local session: opening the local database failed.',
      'Local session: remembering the local account failed.',
    ])
    expect(t.warnings).toHaveLength(1)
    for (const message of [...t.errors, ...t.warnings]) {
      for (const secret of [UID_A, ID_A, ID_A2]) expect(message).not.toContain(secret)
    }
  })
})
