import { replay, type BaitSiteEventType, type ReplayResult } from './baitSiteStateMachine'
import { sortIntoHistoryOrder, type HistoryInstant } from './historyOrder'
import {
  LOADING,
  type LocalBaitSite,
  type LocalSpecies,
  type Loadable,
  type LocalStore,
  type Observable,
  type ProjectRaw,
  type ProjectsRaw,
  type QueueItem,
} from './localStore'
import type { Project, ProjectRole } from './project'

// The merge of confirmed copy + queue (ADR 0008, decision 2). This is the only place pending
// data reaches a screen (ADR 0008, derived rule 1): screens read the views made here, never
// the queue or the raw copy.
//
// Rules shared by every merge below:
// - The same id in the copy and in the queue (the server stored it, the confirmation was
//   lost, a snapshot brought it) shows the confirmed data, marked pending: the item is still
//   in the queue until the 409 -> GET path confirms it.
// - Ids are ordered as plain strings, never with localeCompare (ADR 0007, rule 8).

export interface ProjectListEntry {
  readonly id: string
  readonly name: string
  readonly role: ProjectRole
  /** null while the project exists only in the queue: the server has not given it a date. */
  readonly createdAt: string | null
  /** Its createProject item is still in the queue. */
  readonly pending: boolean
  /** The rejected createProject item with the lowest seq, or null. */
  readonly rejection: { readonly seq: number; readonly status: number; readonly code: string | null } | null
}

type ProjectRejection = NonNullable<ProjectListEntry['rejection']>

export interface EventView {
  readonly id: string
  readonly baitSiteId: string
  readonly type: BaitSiteEventType
  readonly occurredAt: HistoryInstant
  readonly speciesId: string | null
  readonly identifiedEventId: string | null
  /** null while the event exists only in the queue. */
  readonly recordedAt: string | null
  /** A createBaitSite or recordEvent item for it is still in the queue. */
  readonly pending: boolean
}

export interface BaitSiteView {
  readonly id: string
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly locationAccuracyM: number | null
  /** null while the site exists only in the queue. */
  readonly createdAt: string | null
  /** Its createBaitSite item is still in the queue. */
  readonly pending: boolean
  /** Non-voided events, confirmed and pending, in history order, minus pending voids. */
  readonly events: readonly EventView[]
  /** Events hidden because a voidEvent item for them is in the queue, in seq order. */
  readonly pendingVoidEventIds: readonly string[]
  /** replay() over `events`: the status is always computed on the device. */
  readonly replay: ReplayResult
  /** Some queue item of this site has a rejection. */
  readonly rejected: boolean
}

export interface ProjectView {
  /** null when the project is neither in the copy nor in the queue. */
  readonly project: ProjectListEntry | null
  /** In id order. */
  readonly baitSites: readonly BaitSiteView[]
  readonly species: readonly LocalSpecies[]
}

function compareIds(a: { readonly id: string }, b: { readonly id: string }): number {
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

interface PendingProject {
  readonly name: string
  rejection: ProjectRejection | null
}

/**
 * createProject items by project id; the first item gives the data. The queue is in seq
 * order, so the first rejected item met is the one with the lowest seq.
 */
function pendingProjects(queue: readonly QueueItem[]): Map<string, PendingProject> {
  const result = new Map<string, PendingProject>()
  for (const { seq, payload, rejection } of queue) {
    if (payload.kind !== 'createProject') continue
    const found = rejection === null ? null : { seq, status: rejection.status, code: rejection.code }
    const existing = result.get(payload.projectId)
    if (existing === undefined) {
      result.set(payload.projectId, { name: payload.name, rejection: found })
    } else if (existing.rejection === null) {
      existing.rejection = found
    }
  }
  return result
}

function projectEntry(id: string, confirmed: Project | undefined, pending: PendingProject | undefined): ProjectListEntry | null {
  if (confirmed !== undefined) {
    return {
      id,
      name: confirmed.name,
      role: confirmed.role,
      createdAt: confirmed.createdAt,
      pending: pending !== undefined,
      rejection: pending?.rejection ?? null,
    }
  }
  if (pending !== undefined) {
    // Only the creator has a createProject item, and the creator is the owner.
    return { id, name: pending.name, role: 'OWNER', createdAt: null, pending: true, rejection: pending.rejection }
  }
  return null
}

export function mergeProjects(raw: ProjectsRaw): readonly ProjectListEntry[] {
  const confirmed = new Map(raw.projects.map((project) => [project.id, project]))
  const pending = pendingProjects(raw.queue)
  const ids = new Set([...confirmed.keys(), ...pending.keys()])
  const entries: ProjectListEntry[] = []
  for (const id of ids) {
    const entry = projectEntry(id, confirmed.get(id), pending.get(id))
    if (entry !== null) entries.push(entry)
  }
  return entries.toSorted(compareIds)
}

type PendingSite = Omit<LocalBaitSite, 'projectId' | 'createdAt'>
type PendingEvent = Omit<EventView, 'recordedAt' | 'pending'>

export function mergeProject(raw: ProjectRaw): ProjectView {
  const pendingSites = new Map<string, PendingSite>()
  const pendingEvents = new Map<string, PendingEvent>()
  // Void items per site, in seq order, and every voided id (ids are unique across sites).
  const voidsBySite = new Map<string, Set<string>>()
  const voidedIds = new Set<string>()
  const rejectedSites = new Set<string>()

  // No default branch: a new payload kind does not compile until the merge handles it.
  for (const { payload, rejection } of raw.queue) {
    switch (payload.kind) {
      case 'createProject':
        continue // Handled by pendingProjects below.
      case 'createBaitSite': {
        const { baitSiteId, installation } = payload
        if (!pendingSites.has(baitSiteId)) {
          pendingSites.set(baitSiteId, {
            id: baitSiteId,
            name: payload.name,
            latitude: payload.latitude,
            longitude: payload.longitude,
            locationAccuracyM: payload.locationAccuracyM,
          })
        }
        // Without it, a site created offline would replay as EMPTY.
        if (!pendingEvents.has(installation.id)) {
          pendingEvents.set(installation.id, {
            id: installation.id,
            baitSiteId,
            type: 'INSTALLED',
            occurredAt: installation.occurredAt,
            speciesId: null,
            identifiedEventId: null,
          })
        }
        if (rejection !== null) rejectedSites.add(baitSiteId)
        break
      }
      case 'recordEvent':
        if (!pendingEvents.has(payload.eventId)) {
          pendingEvents.set(payload.eventId, {
            id: payload.eventId,
            baitSiteId: payload.baitSiteId,
            type: payload.type,
            occurredAt: payload.occurredAt,
            speciesId: payload.speciesId,
            identifiedEventId: payload.identifiedEventId,
          })
        }
        if (rejection !== null) rejectedSites.add(payload.baitSiteId)
        break
      case 'voidEvent': {
        let voids = voidsBySite.get(payload.baitSiteId)
        if (voids === undefined) {
          voids = new Set()
          voidsBySite.set(payload.baitSiteId, voids)
        }
        voids.add(payload.eventId)
        voidedIds.add(payload.eventId)
        if (rejection !== null) rejectedSites.add(payload.baitSiteId)
        break
      }
    }
  }

  // Events per site: confirmed first, then pending ones whose id is not confirmed.
  const eventsBySite = new Map<string, EventView[]>()
  const confirmedEventIds = new Set<string>()
  function addEvent(event: EventView): void {
    if (voidedIds.has(event.id)) return
    const list = eventsBySite.get(event.baitSiteId)
    if (list === undefined) eventsBySite.set(event.baitSiteId, [event])
    else list.push(event)
  }
  for (const event of raw.events) {
    confirmedEventIds.add(event.id)
    addEvent({
      id: event.id,
      baitSiteId: event.baitSiteId,
      type: event.type,
      occurredAt: event.occurredAt,
      speciesId: event.speciesId,
      identifiedEventId: event.identifiedEventId,
      recordedAt: event.recordedAt,
      pending: pendingEvents.has(event.id),
    })
  }
  for (const event of pendingEvents.values()) {
    if (!confirmedEventIds.has(event.id)) addEvent({ ...event, recordedAt: null, pending: true })
  }

  // Sites: confirmed data wins; a site only in the queue comes from its createBaitSite item.
  // Events (and voids) of a site that exists in neither are left out.
  const confirmedSites = new Map(raw.baitSites.map((site) => [site.id, site]))
  const siteIds = new Set([...confirmedSites.keys(), ...pendingSites.keys()])
  const baitSites: BaitSiteView[] = []
  for (const id of siteIds) {
    const site: PendingSite | undefined = confirmedSites.get(id) ?? pendingSites.get(id)
    if (site === undefined) continue
    // Sorted, never appended: a pending event may be retroactive.
    const events = sortIntoHistoryOrder(eventsBySite.get(id) ?? [])
    baitSites.push({
      id,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      locationAccuracyM: site.locationAccuracyM,
      createdAt: confirmedSites.get(id)?.createdAt ?? null,
      pending: pendingSites.has(id),
      events,
      pendingVoidEventIds: [...(voidsBySite.get(id) ?? [])],
      replay: replay(events),
      rejected: rejectedSites.has(id),
    })
  }

  const projectId = raw.project?.id ?? null
  const pending = pendingProjects(raw.queue)
  // The queue holds only this project's items, so at most one createProject id is there.
  const [pendingId] = pending.keys()
  const id = projectId ?? pendingId ?? null
  return {
    project: id === null ? null : projectEntry(id, raw.project ?? undefined, pending.get(id)),
    baitSites: baitSites.toSorted(compareIds),
    species: raw.species,
  }
}

/**
 * Recomputes the merged value only when the raw snapshot object changes (===), so
 * getSnapshot returns the same object while nothing changed (required by useSyncExternalStore).
 */
function cachedView<R, V>(source: Observable<R>, merge: (raw: R) => V): Observable<V> {
  let lastRaw: Loadable<R> | null = null
  let lastView: Loadable<V> = LOADING
  return {
    subscribe: (listener) => source.subscribe(listener),
    getSnapshot() {
      const raw = source.getSnapshot()
      if (raw !== lastRaw) {
        lastRaw = raw
        lastView = raw.status === 'loading' ? LOADING : { status: 'ready', value: merge(raw.value) }
      }
      return lastView
    },
  }
}

export function createProjectsView(store: LocalStore): Observable<readonly ProjectListEntry[]> {
  return cachedView(store.observeProjects(), mergeProjects)
}

export function createProjectView(store: LocalStore, projectId: string): Observable<ProjectView> {
  return cachedView(store.observeProject(projectId), mergeProject)
}
