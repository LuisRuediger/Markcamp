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
 * The latest CAPTURED in site.events (history order), or null. What an IDENTIFIED points to
 * (decision J4 of slice F3). Picked with compareHistoryOrder, not by array position.
 */
export function identificationTarget(site: BaitSiteView): EventView | null {
  let latest: EventView | null = null
  for (const event of site.events) {
    if (event.type !== 'CAPTURED') continue
    if (latest === null || compareHistoryOrder(event, latest) > 0) latest = event
  }
  return latest
}

// Stands for "an event recorded now" in allowedEventTypes. Only its position matters (last);
// it is not a UUID, so it cannot collide with a real event id.
const SIMULATED_ID = 'simulated-new-event'

/**
 * Event types that would be valid if recorded now (appended at the end of site.events), in
 * BAIT_SITE_EVENT_TYPES order. IDENTIFIED only when identificationTarget is not null.
 * Empty when site.replay is invalid.
 */
export function allowedEventTypes(site: BaitSiteView): readonly BaitSiteEventType[] {
  if (!site.replay.valid) return []
  const target = identificationTarget(site)
  return BAIT_SITE_EVENT_TYPES.filter((type) => {
    if (type === 'IDENTIFIED' && target === null) return false
    const simulated: ReplayEvent = {
      id: SIMULATED_ID,
      type,
      identifiedEventId: type === 'IDENTIFIED' && target !== null ? target.id : null,
    }
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
