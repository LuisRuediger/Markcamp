import { BAIT_SITE_EVENT_TYPES, replay, type BaitSiteEventType, type ReplayEvent } from './baitSiteStateMachine'
import { compareHistoryOrder, sortIntoHistoryOrder, type HistoryOrderKey } from './historyOrder'
import type { BaitSiteView, EventView } from './localMerge'

// What the bait site screens need to know before offering an action (slice F3). Nothing is
// decided here: every answer is replay() over the site's merged history, seen from the
// screen. There is no copy of the transition table (ADR 0005), so the device cannot drift
// from the state machine that the shared cases file checks.

// Exactly "Isca", one space, 1 to 9 ASCII digits. [0-9], not \d, so the rule reads the same
// as written; case-sensitive. Nine digits keep the number far below 2^53.
const SUGGESTED_NAME = /^Isca ([0-9]{1,9})$/

/**
 * "Isca N": N = highest number among names exactly "Isca <1-9 digits>", plus 1; "Isca 1" when
 * none. Highest + 1, not count + 1: numbers have gaps (sites named otherwise, or numbers
 * skipped in the field), and a count would suggest a name already in use. The name is not
 * unique: this is only a suggestion, from the names of the project's merged bait sites.
 */
export function suggestBaitSiteName(existingNames: readonly string[]): string {
  let highest = 0
  for (const name of existingNames) {
    const digits = SUGGESTED_NAME.exec(name)?.[1]
    if (digits === undefined) continue
    highest = Math.max(highest, Number(digits))
  }
  return `Isca ${highest + 1}`
}

/** The site, one of its events or a void of one is still in the queue. */
export function hasPendingChanges(site: BaitSiteView): boolean {
  return site.pending || site.events.some((event) => event.pending) || site.pendingVoidEventIds.length > 0
}

/**
 * The species that counts for this capture (ADR 0005, derived rule 4): the speciesId of the
 * latest IDENTIFIED in site.events pointing to it, by compareHistoryOrder (not by array
 * position), else the capture's own speciesId (null when it has none). site.events holds
 * only non-voided events, and a pending void already hides its event (P2), so a voided
 * identification never counts.
 *
 * Meant for CAPTURED events; for any other type it returns the event's own speciesId (only
 * a CAPTURED can be the target of an IDENTIFIED, ADR 0005, rule 5).
 */
export function effectiveSpeciesId(site: BaitSiteView, capture: EventView): string | null {
  if (capture.type !== 'CAPTURED') return capture.speciesId
  let latest: EventView | null = null
  for (const event of site.events) {
    if (event.type !== 'IDENTIFIED' || event.identifiedEventId !== capture.id) continue
    if (latest === null || compareHistoryOrder(event, latest) > 0) latest = event
  }
  return latest === null ? capture.speciesId : latest.speciesId
}

/**
 * Whether any IDENTIFIED in site.events points to this capture. site.events holds only
 * non-voided events (pending included; a pending void already hides its event, P2).
 * The Site screen offers "Identificar espécie" only when this is false (decision N1-b of
 * slice F3-3b): changing a species is voiding the identification, then identifying again.
 */
export function isIdentified(site: BaitSiteView, capture: EventView): boolean {
  return site.events.some((event) => event.type === 'IDENTIFIED' && event.identifiedEventId === capture.id)
}

// Stands for "an event recorded now" in recordableEventTypes. Only its position matters
// (last); it is not a UUID, so it cannot collide with a real event id.
const SIMULATED_ID = 'simulated-new-event'

/**
 * Every event type the type buttons may record. IDENTIFIED is not one: it is recorded from a
 * capture row, for that capture (decision L6 of slice F3-3; slice F3-3b).
 */
export type RecordableType = Exclude<BaitSiteEventType, 'IDENTIFIED'>

function isRecordable(type: BaitSiteEventType): type is RecordableType {
  return type !== 'IDENTIFIED'
}

/**
 * What the type buttons offer (decision L6 of slice F3-3): the types of BAIT_SITE_EVENT_TYPES
 * except IDENTIFIED, in that order, each kept when it would be valid if recorded now
 * (appended at the end of site.events). Empty when site.replay is invalid.
 */
export function recordableEventTypes(site: BaitSiteView): readonly RecordableType[] {
  if (!site.replay.valid) return []
  return BAIT_SITE_EVENT_TYPES.filter(isRecordable).filter((type) => {
    const simulated: ReplayEvent = { id: SIMULATED_ID, type, identifiedEventId: null }
    return replay([...site.events, simulated]).valid
  })
}

/**
 * Whether the site's history stays valid with this event in its place by history order
 * (occurredAt, then id), not at the end. An event dated in the past may land in the middle,
 * and the server validates the history the same way (ADR 0005, rule 5).
 */
export function checkNewEvent(site: BaitSiteView, event: ReplayEvent & HistoryOrderKey): 'ok' | 'invalidSequence' {
  const history: readonly (ReplayEvent & HistoryOrderKey)[] = [...site.events, event]
  return replay(sortIntoHistoryOrder(history)).valid ? 'ok' : 'invalidSequence'
}

/**
 * Whether the site's history stays valid without this event (ADR 0005: dependent events are
 * voided first, never in cascade). 'notFound' when the id is not among site.events.
 */
export function checkVoid(site: BaitSiteView, eventId: string): 'ok' | 'invalidSequence' | 'notFound' {
  if (!site.events.some((event) => event.id === eventId)) return 'notFound'
  return replay(site.events.filter((event) => event.id !== eventId)).valid ? 'ok' : 'invalidSequence'
}
