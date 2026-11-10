import type { BaitSiteEventType } from './baitSiteStateMachine'
import type { HistoryInstant } from './historyOrder'
import type { Project } from './projectsStore'

// The local database as core sees it (ADR 0008, decisions 2, 3, 7 and 10). Implemented by
// the Dexie adapter (slice F2b-2) and by fakeLocalStore.ts for tests. The merge of confirmed
// copy + queue is not here: it is a pure function in localMerge.ts, so no adapter holds
// business rules.

// ---------------------------------------------------------------------------------------
// Confirmed copy: exactly what the server confirmed, minus two things.
// - No bait site status: it is always computed on the device with replay() over confirmed
//   and pending events, so a pending event changes it before it is uploaded.
// - No voided events: a confirmed void deletes the event, like the snapshot leaves it out.
// projectId is stored on sites and events (from the request path or the queue item, the
// response bodies do not carry it), so one project can be read or replaced on its own.
// ---------------------------------------------------------------------------------------

export interface LocalBaitSite {
  readonly id: string
  readonly projectId: string
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  /** null when the site was placed by hand on the map. */
  readonly locationAccuracyM: number | null
  readonly createdAt: string
}

export interface LocalEvent {
  readonly id: string
  readonly projectId: string
  readonly baitSiteId: string
  readonly type: BaitSiteEventType
  readonly occurredAt: HistoryInstant
  readonly speciesId: string | null
  readonly identifiedEventId: string | null
  readonly recordedAt: string
}

export interface LocalSpecies {
  readonly id: string
  readonly scientificName: string
  readonly commonName: string
}

// ---------------------------------------------------------------------------------------
// Upload queue: pending changes live only here (ADR 0008, decision 2), with the full payload.
// ---------------------------------------------------------------------------------------

export type QueuePayload =
  | {
      readonly kind: 'createProject'
      readonly projectId: string
      readonly name: string
    }
  | {
      readonly kind: 'createBaitSite'
      readonly projectId: string
      readonly baitSiteId: string
      readonly name: string
      readonly latitude: number
      readonly longitude: number
      readonly locationAccuracyM: number | null
      readonly installation: { readonly id: string; readonly occurredAt: HistoryInstant }
    }
  | {
      // Any of the 8 types: a new cycle on an existing site is a recorded INSTALLED (ADR 0005).
      readonly kind: 'recordEvent'
      readonly projectId: string
      readonly baitSiteId: string
      readonly eventId: string
      readonly type: BaitSiteEventType
      readonly occurredAt: HistoryInstant
      readonly speciesId: string | null
      readonly identifiedEventId: string | null
    }
  | {
      readonly kind: 'voidEvent'
      readonly projectId: string
      readonly baitSiteId: string
      readonly eventId: string
    }

/** Kept on the item so a blocked item is not resent on its own when the app reopens (ADR 0008, decision 6). */
export interface QueueRejection {
  readonly status: number
  readonly code: string | null
}

export interface QueueItem {
  /** Recording order. Assigned by the store, strictly increasing, never reused (not even after a discard). */
  readonly seq: number
  readonly payload: QueuePayload
  readonly rejection: QueueRejection | null
}

// ---------------------------------------------------------------------------------------
// Confirmations: what confirm() writes into the copy. One kind per payload kind.
// ---------------------------------------------------------------------------------------

export type Confirmation =
  | { readonly kind: 'projectCreated'; readonly project: Project }
  // Site and INSTALLED together: without the event, the site would show EMPTY until the next snapshot.
  | { readonly kind: 'baitSiteCreated'; readonly baitSite: LocalBaitSite; readonly installed: LocalEvent }
  | { readonly kind: 'eventRecorded'; readonly event: LocalEvent }
  // Deletes the event from the copy (voided events are not kept); nothing happens if it is absent.
  | { readonly kind: 'eventVoided'; readonly eventId: string }

/**
 * Thrown by confirm() when the confirmation does not belong to the queue item. A programming
 * error: nothing is changed. The message names the field, never its value.
 */
export class ConfirmationMismatchError extends Error {
  constructor(payloadKind: QueuePayload['kind'], confirmationKind: Confirmation['kind'], field: string) {
    super(`Confirmation ${confirmationKind} does not match the ${payloadKind} queue item (${field}).`)
    this.name = 'ConfirmationMismatchError'
  }
}

/**
 * Throws ConfirmationMismatchError unless the confirmation is the answer to this item: the
 * matching kind and the same ids. If the sync engine paired a response with the wrong item,
 * confirm() would remove an item that was never sent: silent data loss (ADR 0008).
 *
 * Only identity is compared (ids as plain strings, ADR 0007 rule 8, plus the event type).
 * Data fields such as occurredAt or name are not: the server's answer is the truth for them.
 *
 * Here, not in an adapter, so every implementation applies the same rule. No default branch:
 * a new payload kind does not compile until it is handled.
 */
export function assertConfirmationMatches(item: QueueItem, confirmation: Confirmation): void {
  const { payload } = item
  function check(matches: boolean, field: string): void {
    if (!matches) throw new ConfirmationMismatchError(payload.kind, confirmation.kind, field)
  }
  switch (payload.kind) {
    case 'createProject':
      if (confirmation.kind !== 'projectCreated') return check(false, 'kind')
      check(confirmation.project.id === payload.projectId, 'project.id')
      return
    case 'createBaitSite': {
      if (confirmation.kind !== 'baitSiteCreated') return check(false, 'kind')
      const { baitSite, installed } = confirmation
      check(baitSite.id === payload.baitSiteId, 'baitSite.id')
      check(baitSite.projectId === payload.projectId, 'baitSite.projectId')
      check(installed.id === payload.installation.id, 'installed.id')
      check(installed.baitSiteId === payload.baitSiteId, 'installed.baitSiteId')
      check(installed.projectId === payload.projectId, 'installed.projectId')
      check(installed.type === 'INSTALLED', 'installed.type')
      return
    }
    case 'recordEvent': {
      if (confirmation.kind !== 'eventRecorded') return check(false, 'kind')
      const { event } = confirmation
      check(event.id === payload.eventId, 'event.id')
      check(event.baitSiteId === payload.baitSiteId, 'event.baitSiteId')
      check(event.projectId === payload.projectId, 'event.projectId')
      check(event.type === payload.type, 'event.type')
      return
    }
    case 'voidEvent':
      if (confirmation.kind !== 'eventVoided') return check(false, 'kind')
      check(confirmation.eventId === payload.eventId, 'eventId')
      return
  }
}

// ---------------------------------------------------------------------------------------
// Reads: consumable with useSyncExternalStore.
// ---------------------------------------------------------------------------------------

export type Loadable<T> = { readonly status: 'loading' } | { readonly status: 'ready'; readonly value: T }

/** One shared object, so a "still loading" snapshot is always the same (===). */
export const LOADING: Loadable<never> = { status: 'loading' }

/**
 * Once an Observable instance is ready it never goes back to loading, not even after its
 * last listener unsubscribes: it keeps its last value until the next emission. React
 * StrictMode subscribes, unsubscribes and resubscribes on mount; going back to loading would
 * flash the loading state, while a stale value is followed by a fresh emission.
 */
export interface Observable<T> {
  subscribe(listener: () => void): () => void
  getSnapshot(): Loadable<T>
}

export interface ProjectsRaw {
  readonly projects: readonly Project[]
  /** The createProject items, in seq order. */
  readonly queue: readonly QueueItem[]
}

export interface ProjectRaw {
  readonly project: Project | null
  readonly baitSites: readonly LocalBaitSite[]
  readonly events: readonly LocalEvent[]
  /** Global, not per project: they ride along because every project screen needs them. */
  readonly species: readonly LocalSpecies[]
  /** Every item of this project (its createProject included), in seq order. */
  readonly queue: readonly QueueItem[]
}

export interface ProjectSnapshot {
  readonly baitSites: readonly LocalBaitSite[]
  readonly events: readonly LocalEvent[]
  readonly species: readonly LocalSpecies[]
}

/** Thrown by replaceProjectSnapshot() for a row of another project. Nothing is changed. */
export class SnapshotMismatchError extends Error {
  constructor(field: 'baitSites' | 'events') {
    super(`Project snapshot contains ${field} of another project.`)
    this.name = 'SnapshotMismatchError'
  }
}

/**
 * Throws SnapshotMismatchError unless every bait site and event has this projectId. The
 * snapshot replaces a whole project: a wrong row would silently land in another one.
 */
export function assertSnapshotBelongsTo(projectId: string, snapshot: ProjectSnapshot): void {
  if (!snapshot.baitSites.every((site) => site.projectId === projectId)) throw new SnapshotMismatchError('baitSites')
  if (!snapshot.events.every((event) => event.projectId === projectId)) throw new SnapshotMismatchError('events')
}

/**
 * The local database as domain operations (ADR 0008, decision 10): no tables and no
 * transactions in core's hands. The merge of confirmed + pending is localMerge.ts.
 *
 * Contract (checked by localStore.suite.ts against every implementation):
 *
 * - Reads start `loading` and become `ready` after the first load once subscribed. While
 *   subscribed, listeners are called after every committed write that changes what that
 *   observable returns. Calling them more often is allowed (the merge cache absorbs it);
 *   calling them synchronously is not required.
 * - An observable that became `ready` never returns to `loading`, even with no listener
 *   left (see Observable). A new observeProject(X) call may start at `loading`.
 * - confirm() calls assertConfirmationMatches and replaceProjectSnapshot() calls
 *   assertSnapshotBelongsTo inside the same atomic step as the write, before writing, so a
 *   throw changes nothing. No implementation re-implements these checks.
 * - `getSnapshot()` returns the same object (===) as long as no write is committed, and a
 *   new object after a write that changes what it returns. After a write that does not
 *   change it (another project, say) it may return either.
 * - Lists: projects and bait sites by id, compared as plain strings (canonical lowercase
 *   UUID v7, ADR 0007 rule 8; the server's (created_at, id) differs only with a wrong
 *   device clock); events in no particular order (the merge sorts them); queue by seq;
 *   species in no specified order.
 * - Arrays and objects handed out are never mutated afterwards.
 * - observeProject(X) never contains data or queue items of another project.
 */
export interface LocalStore {
  observeProjects(): Observable<ProjectsRaw>
  observeProject(projectId: string): Observable<ProjectRaw>

  /** Adds an item with the next seq and no rejection. */
  enqueue(payload: QueuePayload): Promise<QueueItem>

  /** Every item of every project, in seq order. The sync engine decides what to send. */
  queuedItems(): Promise<readonly QueueItem[]>

  /**
   * Atomic (ADR 0008, decision 3): removes the item and writes the confirmation into the
   * copy, or does neither. Writes overwrite by id: a confirmation is the server's truth.
   * 'itemMissing' (the item was discarded while its request was in flight) writes nothing;
   * the next snapshot brings the server's truth. Rejects with ConfirmationMismatchError,
   * changing nothing, when the confirmation does not match the item's kind or ids
   * (assertConfirmationMatches).
   */
  confirm(seq: number, confirmation: Confirmation): Promise<'confirmed' | 'itemMissing'>

  /** No-op on a missing item. */
  markRejected(seq: number, rejection: QueueRejection): Promise<void>
  /** The user's "retry". No-op on a missing item. */
  clearRejection(seq: number): Promise<void>
  /**
   * The user's "discard": removes exactly this item, never dependent ones. No-op on a
   * missing item. Apart from confirm(), the only way an item leaves the queue (ADR 0008, rule 2).
   */
  discard(seq: number): Promise<void>

  /** Replaces the projects only; bait sites, events, species and queue are untouched. */
  replaceProjects(projects: readonly Project[]): Promise<void>

  /**
   * Atomic: replaces this project's bait sites and events entirely, and the species list.
   * Never reads or writes the queue (ADR 0008, rule 3) and never touches another project.
   * Rejects with SnapshotMismatchError, changing nothing, when a bait site or event has
   * another projectId (assertSnapshotBelongsTo).
   */
  replaceProjectSnapshot(projectId: string, snapshot: ProjectSnapshot): Promise<void>
}
