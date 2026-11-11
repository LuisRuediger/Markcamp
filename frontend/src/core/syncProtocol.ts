import type { ApiRequest, ApiResult } from './apiClient'
import { BAIT_SITE_EVENT_TYPES, type BaitSiteEventType } from './baitSiteStateMachine'
import { toHistoryInstant } from './historyOrder'
import type {
  LocalBaitSite,
  LocalEvent,
  LocalSpecies,
  QueueItem,
  QueuePayload,
  QueueRejection,
} from './localStore'

// The pure half of the sync engine (ADR 0008): what an API answer means for a queue item,
// which items may be sent, which request each item becomes, and how answer bodies become
// rows of the confirmed copy. No I/O here; syncEngine.ts does the sending and the writing.

// ---------------------------------------------------------------------------------------
// What an answer does to a queue item.
// ---------------------------------------------------------------------------------------

export type ResultAction =
  /** The server accepted: confirm with the body, if it is valid. */
  | { readonly kind: 'confirm'; readonly body: unknown }
  /** 409 ID_ALREADY_EXISTS on a create: GET the resource to find out whether it is ours. */
  | { readonly kind: 'lookUp' }
  /** Transient: the item stays as it is and the upload stops until the next trigger. */
  | { readonly kind: 'defer' }
  /** The same request would get the same answer: blocked until the user's retry. */
  | { readonly kind: 'reject'; readonly rejection: QueueRejection }

const LOOK_UP: ResultAction = { kind: 'lookUp' }
const DEFER: ResultAction = { kind: 'defer' }

/**
 * The rejection recorded when a 409 ID_ALREADY_EXISTS turns out not to be ours (the GET
 * finds nothing, or finds a voided event): the status and code of the create's answer.
 */
export const ID_NOT_OURS: QueueRejection = { status: 409, code: 'ID_ALREADY_EXISTS' }

/**
 * The E1 table of slice F2c (ADR 0006: the status decides first, then the code).
 *
 * - unavailable (no network, timeout, no token) and unauthorized defer: the session store
 *   handles the sign-out, the queue stays (ADR 0004, rule 7).
 * - 5xx, 408 and 429 defer: the server or the path to it may answer differently later.
 *   A deterministic 500 stalls everything behind it; accepted, since skipping the item
 *   would break the per-site order and "no client input produces a 5xx" is a backend rule.
 * - Any other 4xx rejects: resending the same payload gets the same answer, so an automatic
 *   retry would be an endless loop.
 */
export function classifyResult(result: ApiResult): ResultAction {
  switch (result.kind) {
    case 'ok':
      return { kind: 'confirm', body: result.body }
    case 'unavailable':
    case 'unauthorized':
      return DEFER
    case 'apiError': {
      const { status, code } = result
      if (status >= 500 || status === 408 || status === 429) return DEFER
      if (status === 409 && code === 'ID_ALREADY_EXISTS') return LOOK_UP
      return { kind: 'reject', rejection: { status, code } }
    }
  }
}

export type FollowUpAction =
  | Exclude<ResultAction, { readonly kind: 'lookUp' }>
  /** 404 on the GET after ID_ALREADY_EXISTS: the id exists, but not for us. */
  | { readonly kind: 'idNotOurs' }

const ID_NOT_OURS_ACTION: FollowUpAction = { kind: 'idNotOurs' }

/**
 * A GET that follows a create (the look-up after ID_ALREADY_EXISTS, or the INSTALLED of a
 * new bait site): the same table, except that 404 after ID_ALREADY_EXISTS means "not ours",
 * and a GET never asks for another look-up (a 409 on a GET is rejected like any 4xx).
 */
export function classifyFollowUp(result: ApiResult, afterIdAlreadyExists: boolean): FollowUpAction {
  if (afterIdAlreadyExists && result.kind === 'apiError' && result.status === 404) return ID_NOT_OURS_ACTION
  const action = classifyResult(result)
  if (action.kind !== 'lookUp') return action
  return { kind: 'reject', rejection: ID_NOT_OURS }
}

// ---------------------------------------------------------------------------------------
// Which items may be sent.
// ---------------------------------------------------------------------------------------

/** null for a createProject, which belongs to no bait site. No default branch. */
function baitSiteIdOf(payload: QueuePayload): string | null {
  switch (payload.kind) {
    case 'createProject':
      return null
    case 'createBaitSite':
    case 'recordEvent':
    case 'voidEvent':
      return payload.baitSiteId
  }
}

/**
 * The items the upload may send, in seq order (the queue comes in seq order, LocalStore
 * contract). An item is not sendable when it has a rejection, when a createProject of its
 * project with a lower seq is rejected (the whole project waits), or when an item of its
 * bait site with a lower seq is rejected (the rest of that site waits; other sites go on).
 *
 * Only a rejection blocks, never a missing item: a discard removes exactly one item (ADR
 * 0008, rule 2), so a dependent of a discarded item is sent, gets a 404 and is rejected
 * itself. The app never deletes a record the user did not ask to delete.
 */
export function sendableItems(queue: readonly QueueItem[]): readonly QueueItem[] {
  const rejectedProjects = new Set<string>()
  const rejectedSites = new Set<string>()
  const sendable: QueueItem[] = []
  for (const item of queue) {
    const { payload } = item
    const baitSiteId = baitSiteIdOf(payload)
    if (item.rejection !== null) {
      if (baitSiteId === null) rejectedProjects.add(payload.projectId)
      else rejectedSites.add(baitSiteId)
      continue
    }
    if (rejectedProjects.has(payload.projectId)) continue
    if (baitSiteId !== null && rejectedSites.has(baitSiteId)) continue
    sendable.push(item)
  }
  return sendable
}

// ---------------------------------------------------------------------------------------
// Requests. Paths are relative to the API base; every id comes from the queue item.
// ---------------------------------------------------------------------------------------

const projectPath = (projectId: string) => `/projects/${projectId}`
const baitSitePath = (projectId: string, baitSiteId: string) => `${projectPath(projectId)}/bait-sites/${baitSiteId}`
const eventPath = (projectId: string, baitSiteId: string, eventId: string) =>
  `${baitSitePath(projectId, baitSiteId)}/events/${eventId}`

type PayloadOf<K extends QueuePayload['kind']> = Extract<QueuePayload, { readonly kind: K }>

export function createProjectRequest(payload: PayloadOf<'createProject'>): ApiRequest {
  return { method: 'POST', path: '/projects', body: { id: payload.projectId, name: payload.name } }
}

export function createBaitSiteRequest(payload: PayloadOf<'createBaitSite'>): ApiRequest {
  return {
    method: 'POST',
    path: `${projectPath(payload.projectId)}/bait-sites`,
    body: {
      id: payload.baitSiteId,
      name: payload.name,
      latitude: payload.latitude,
      longitude: payload.longitude,
      locationAccuracyM: payload.locationAccuracyM,
      installation: { id: payload.installation.id, occurredAt: payload.installation.occurredAt },
    },
  }
}

export function recordEventRequest(payload: PayloadOf<'recordEvent'>): ApiRequest {
  return {
    method: 'POST',
    path: `${baitSitePath(payload.projectId, payload.baitSiteId)}/events`,
    body: {
      id: payload.eventId,
      type: payload.type,
      occurredAt: payload.occurredAt,
      speciesId: payload.speciesId,
      identifiedEventId: payload.identifiedEventId,
    },
  }
}

/** No body: the path says everything. */
export function voidEventRequest(payload: PayloadOf<'voidEvent'>): ApiRequest {
  return { method: 'POST', path: `${eventPath(payload.projectId, payload.baitSiteId, payload.eventId)}/void` }
}

export function getProjectRequest(projectId: string): ApiRequest {
  return { method: 'GET', path: projectPath(projectId) }
}

export function getBaitSiteRequest(projectId: string, baitSiteId: string): ApiRequest {
  return { method: 'GET', path: baitSitePath(projectId, baitSiteId) }
}

export function getEventRequest(projectId: string, baitSiteId: string, eventId: string): ApiRequest {
  return { method: 'GET', path: eventPath(projectId, baitSiteId, eventId) }
}

export const LIST_PROJECTS_REQUEST: ApiRequest = { method: 'GET', path: '/projects' }
export const LIST_SPECIES_REQUEST: ApiRequest = { method: 'GET', path: '/species' }

export function listBaitSitesRequest(projectId: string): ApiRequest {
  return { method: 'GET', path: `${projectPath(projectId)}/bait-sites` }
}

export function listProjectEventsRequest(projectId: string): ApiRequest {
  return { method: 'GET', path: `${projectPath(projectId)}/events` }
}

// ---------------------------------------------------------------------------------------
// Body parsers. They copy only the known fields: the local copy never carries anything else
// from a body. projectId comes from the path or the queue item (bodies do not carry it).
// null means "not a valid body".
// ---------------------------------------------------------------------------------------

/** A reader of the object's own fields, or null when the value is not a plain object. */
function fieldsOf(value: unknown): ((key: string) => unknown) | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const object: object = value
  return (key) => (Object.hasOwn(object, key) ? Reflect.get(object, key) : undefined)
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function eventTypeOf(value: unknown): BaitSiteEventType | null {
  return BAIT_SITE_EVENT_TYPES.find((type) => type === value) ?? null
}

/** `status` is ignored: the device always computes it with replay() (ADR 0008). */
export function parseBaitSite(value: unknown, projectId: string): LocalBaitSite | null {
  const field = fieldsOf(value)
  if (field === null) return null
  const id = field('id')
  const name = field('name')
  const latitude = field('latitude')
  const longitude = field('longitude')
  const locationAccuracyM = field('locationAccuracyM')
  const createdAt = field('createdAt')
  if (typeof id !== 'string' || typeof name !== 'string' || typeof createdAt !== 'string') return null
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null
  if (locationAccuracyM !== null && typeof locationAccuracyM !== 'number') return null
  return { id, projectId, name, latitude, longitude, locationAccuracyM, createdAt }
}

export interface ParsedEvent {
  readonly event: LocalEvent
  /** voidedAt was not null. The copy never keeps voided events, so it is not copied. */
  readonly voided: boolean
}

export function parseEvent(value: unknown, projectId: string): ParsedEvent | null {
  const field = fieldsOf(value)
  if (field === null) return null
  const id = field('id')
  const baitSiteId = field('baitSiteId')
  const type = eventTypeOf(field('type'))
  const occurredAtText = field('occurredAt')
  const speciesId = field('speciesId')
  const identifiedEventId = field('identifiedEventId')
  const recordedAt = field('recordedAt')
  const voidedAt = field('voidedAt')
  if (typeof id !== 'string' || typeof baitSiteId !== 'string' || type === null) return null
  if (typeof occurredAtText !== 'string' || typeof recordedAt !== 'string') return null
  // Jackson writes 0, 3 or 6 fraction digits; the copy keeps the normalized form.
  const occurredAt = toHistoryInstant(occurredAtText)
  if (occurredAt === null) return null
  if (!isStringOrNull(speciesId) || !isStringOrNull(identifiedEventId) || !isStringOrNull(voidedAt)) return null
  return {
    event: { id, projectId, baitSiteId, type, occurredAt, speciesId, identifiedEventId, recordedAt },
    voided: voidedAt !== null,
  }
}

export function parseSpecies(value: unknown): LocalSpecies | null {
  const field = fieldsOf(value)
  if (field === null) return null
  const id = field('id')
  const scientificName = field('scientificName')
  const commonName = field('commonName')
  if (typeof id !== 'string' || typeof scientificName !== 'string' || typeof commonName !== 'string') return null
  return { id, scientificName, commonName }
}

/** `{ "items": [...] }`; one invalid item makes the whole body invalid. */
function parseItems<T>(body: unknown, parse: (value: unknown) => T | null): readonly T[] | null {
  const items = fieldsOf(body)?.('items')
  if (!Array.isArray(items)) return null
  const values: unknown[] = items
  const result: T[] = []
  for (const value of values) {
    const parsed = parse(value)
    if (parsed === null) return null
    result.push(parsed)
  }
  return result
}

export function parseBaitSiteList(body: unknown, projectId: string): readonly LocalBaitSite[] | null {
  return parseItems(body, (value) => parseBaitSite(value, projectId))
}

/** The project-wide list holds only non-voided events (ADR 0008, decision 8): a voided one is a broken body. */
export function parseProjectEventList(body: unknown, projectId: string): readonly LocalEvent[] | null {
  return parseItems(body, (value) => {
    const parsed = parseEvent(value, projectId)
    return parsed === null || parsed.voided ? null : parsed.event
  })
}

export function parseSpeciesList(body: unknown): readonly LocalSpecies[] | null {
  return parseItems(body, parseSpecies)
}
