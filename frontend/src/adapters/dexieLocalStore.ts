import { Dexie, liveQuery, type EntityTable, type Subscription } from 'dexie'
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
} from '../core/localStore'
import type { Logger } from '../core/ports'
import type { Project } from '../core/project'

// The LocalStore port on IndexedDB through Dexie (ADR 0008, decision 10). Only transactions
// and queries live here: every rule (what matches, what belongs where) is core's.
//
// Rows are the port types as they are, with no conversion layer: only this adapter writes
// them. Consequence: changing one of these types after the first real use needs a new
// schema version with an upgrade().

/** One database per user (ADR 0008, decision 9): isolation by construction, no owner column. */
function databaseName(userId: string): string {
  return `markcamp-${userId}`
}

class LocalDatabase extends Dexie {
  // `declare`: Dexie creates these properties itself in version().stores(); a class field
  // would be emitted and reset them. A typing of what Dexie provides, not an `as` cast.
  declare readonly projects: EntityTable<Project, 'id'>
  declare readonly baitSites: EntityTable<LocalBaitSite, 'id'>
  declare readonly events: EntityTable<LocalEvent, 'id'>
  declare readonly species: EntityTable<LocalSpecies, 'id'>
  declare readonly queue: EntityTable<QueueItem, 'seq'>

  constructor(name: string) {
    super(name)
    // Schema version rule: until the first real use on the iPhone (slice F2d) version 1 may
    // be edited; after that only a new version (with upgrade() if a row's shape changes),
    // never an edit of an installed one. Dexie compares this version with the database on
    // the device: an edited installed version leaves a schema the code does not know.
    // An index only where a port operation queries by it (decision D1 of slice F2b-2).
    // Locked by the schema test in dexieLocalStore.test.ts.
    this.version(1).stores({
      projects: 'id',
      baitSites: 'id, projectId',
      events: 'id, projectId',
      species: 'id',
      // ++: IndexedDB's key generator, which never reuses a number (port contract of seq).
      queue: '++seq',
    })
  }
}

/** Fixed phrase: an IndexedDB error message may carry data. */
const READ_FAILED = 'Local database read failed.'

/**
 * Opens the user's database (markcamp-<userId>). Version and open errors reject here, not
 * on the first read. close() never deletes anything: logout keeps the queue (ADR 0004).
 */
export async function openDexieLocalStore(userId: string, logger: Logger): Promise<LocalStore & { close(): void }> {
  const db = new LocalDatabase(databaseName(userId))
  await db.open()

  /**
   * One liveQuery per observable, started by the first listener and stopped by the last.
   * The querier reads everything in one read transaction, so an emission never shows half
   * a write (the item gone and the confirmed row not there yet).
   */
  function observe<T>(querier: () => Promise<T>): Observable<T> {
    const listeners = new Set<() => void>()
    // One new object per emission; getSnapshot() only returns it, so it is === between
    // emissions. Kept when the last listener leaves: once ready, never loading again.
    let snapshot: Loadable<T> = LOADING
    let subscription: Subscription | null = null

    function notify(): void {
      for (const listener of [...listeners]) listener()
    }

    return {
      subscribe(listener) {
        listeners.add(listener)
        if (subscription === null) {
          subscription = liveQuery(querier).subscribe({
            next(value) {
              snapshot = { status: 'ready', value }
              notify()
            },
            // The snapshot stays as it was. No retry here. Dexie keeps the subscription alive
            // after an error and runs the query again on the next relevant write, so the
            // phrase can be logged more than once and a later good state is emitted again.
            // Accepted: nothing here retries on its own.
            error() {
              logger.error(READ_FAILED)
            },
          })
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size === 0 && subscription !== null) {
            subscription.unsubscribe()
            subscription = null
          }
        }
      },
      getSnapshot: () => snapshot,
    }
  }

  // Inside a Dexie transaction only Dexie operations are awaited: awaiting anything else
  // could let IndexedDB commit the transaction early.

  /** No default branch: a new kind must be handled here. */
  async function applyConfirmation(confirmation: Confirmation): Promise<void> {
    switch (confirmation.kind) {
      case 'projectCreated':
        await db.projects.put(confirmation.project)
        return
      case 'baitSiteCreated':
        await db.baitSites.put(confirmation.baitSite)
        await db.events.put(confirmation.installed)
        return
      case 'eventRecorded':
        await db.events.put(confirmation.event)
        return
      case 'eventVoided':
        await db.events.delete(confirmation.eventId)
        return
    }
  }

  return {
    observeProjects: () =>
      observe(
        (): Promise<ProjectsRaw> =>
          db.transaction('r', [db.projects, db.queue], async () => ({
            // Primary-key order: by id, compared by code unit like the fake.
            projects: await db.projects.toArray(),
            queue: (await db.queue.toArray()).filter((item) => item.payload.kind === 'createProject'),
          })),
      ),

    observeProject: (projectId) =>
      observe(
        (): Promise<ProjectRaw> =>
          db.transaction('r', [db.projects, db.baitSites, db.events, db.species, db.queue], async () => ({
            project: (await db.projects.get(projectId)) ?? null,
            // Within one projectId of the index, rows come in primary-key order: by id.
            baitSites: await db.baitSites.where('projectId').equals(projectId).toArray(),
            events: await db.events.where('projectId').equals(projectId).toArray(),
            species: await db.species.toArray(),
            // The queue is small and empties quickly: read whole, filter here (no index).
            queue: (await db.queue.toArray()).filter((item) => item.payload.projectId === projectId),
          })),
      ),

    // One table, so one read is already consistent: no explicit transaction needed. Primary-key
    // order is seq order. No index: the whole queue is the answer (version 1 stays as it is).
    observeQueue: () => observe((): Promise<readonly QueueItem[]> => db.queue.toArray()),

    async enqueue(payload) {
      // The key generator assigns seq; never computed here.
      const seq = await db.queue.add({ payload, rejection: null })
      return { seq, payload, rejection: null }
    },

    queuedItems: () => db.queue.toArray(),

    confirm: (seq, confirmation) =>
      db.transaction('rw', [db.queue, db.projects, db.baitSites, db.events], async (): Promise<'confirmed' | 'itemMissing'> => {
        const item = await db.queue.get(seq)
        if (item === undefined) return 'itemMissing'
        // Before any write: a throw aborts the transaction and nothing changes. With Dexie the
        // abort would roll a write back anyway; the check stays first to match the fake (which
        // has no rollback) and the port contract.
        assertConfirmationMatches(item, confirmation)
        // Item removed and confirmation written in the same transaction (ADR 0008, decision 3).
        await db.queue.delete(seq)
        await applyConfirmation(confirmation)
        return 'confirmed'
      }),

    async markRejected(seq, rejection) {
      await db.transaction('rw', db.queue, async () => {
        await db.queue.update(seq, { rejection })
      })
    },

    async clearRejection(seq) {
      await db.transaction('rw', db.queue, async () => {
        await db.queue.update(seq, { rejection: null })
      })
    },

    async discard(seq) {
      await db.transaction('rw', db.queue, async () => {
        await db.queue.delete(seq)
      })
    },

    async replaceProjects(projects) {
      await db.transaction('rw', db.projects, async () => {
        await db.projects.clear()
        await db.projects.bulkPut(projects)
      })
    },

    async replaceProjectSnapshot(projectId, snapshot) {
      // The queue table is not in this transaction, so it cannot be read or written here
      // (ADR 0008, derived rule 3): impossible rather than careful.
      await db.transaction('rw', [db.baitSites, db.events, db.species], async () => {
        // Before any write: a throw aborts the transaction and nothing changes.
        assertSnapshotBelongsTo(projectId, snapshot)
        await db.baitSites.where('projectId').equals(projectId).delete()
        await db.events.where('projectId').equals(projectId).delete()
        await db.baitSites.bulkPut(snapshot.baitSites)
        await db.events.bulkPut(snapshot.events)
        await db.species.clear()
        await db.species.bulkPut(snapshot.species)
      })
    },

    // After close() the observables of this store never emit again and report no error:
    // Dexie's liveQuery does not deliver DatabaseClosedError to its observer. A store, its
    // observables and the merge views built on them belong to one session; whoever reopens
    // must create new ones.
    close() {
      db.close()
    },
  }
}
