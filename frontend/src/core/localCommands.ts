import type { BaitSiteEventType } from './baitSiteStateMachine'
import { checkNewEvent, checkVoid } from './baitSiteRules'
import { toHistoryInstant, type HistoryInstant } from './historyOrder'
import type { BaitSiteView } from './localMerge'
import type { LocalSession, SubmitOutcome } from './localSession'
import type { IdGenerator } from './ports'

// What the screens ask the local database to do (ADR 0008, decision 1). Domain ids are born
// here, never in ui, and the local session stays unaware of payload kinds. The id goes into
// the queue item, so every sync attempt reuses it (ADR 0002, rule 2): the client id is born
// once, at the first send.
//
// Events and voids are checked with replay() on the device before anything enters the queue
// (ADR 0008, decision 6; decision J4 of slice F3): an impossible sequence is refused while
// the user is still at the site. The site is the view the screen shows, not read again here:
// with one user it is at most one tick old, and if it were stale the server still checks and
// the item comes back rejected, never lost.

/** 'invalidSequence': the check on the device refused it and nothing was submitted. */
export type CommandOutcome = SubmitOutcome | 'invalidSequence'

/** 'dateOutOfRange': occurredAt is before 2000-01-01 or after now on the device clock; nothing was submitted. */
export type DateOutcome = 'dateOutOfRange'

// The server's lower bound (OccurredAtValidator.EARLIEST), as a HistoryInstant: fixed width,
// so it compares as plain text.
const EARLIEST_OCCURRED_AT = '2000-01-01T00:00:00.000000Z'

/** Fields by type, so the compiler refuses a payload the server would reject (RecordBaitSiteEventRequest). */
export type NewEvent =
  | { readonly type: 'CAPTURED'; readonly speciesId: string | null }
  | { readonly type: 'IDENTIFIED'; readonly speciesId: string; readonly identifiedEventId: string }
  | { readonly type: Exclude<BaitSiteEventType, 'CAPTURED' | 'IDENTIFIED'> }

export interface NewBaitSite {
  readonly projectId: string
  readonly name: string
  readonly latitude: number
  readonly longitude: number
  readonly locationAccuracyM: number | null
  /** null = now. */
  readonly occurredAt: HistoryInstant | null
}

export interface LocalCommands {
  /** Generates the project id and submits a createProject item. Rejects if submit rejects. */
  createProject(name: string): Promise<SubmitOutcome>
  /**
   * New site id + its INSTALLED id; submits one createBaitSite item. A first INSTALLED is always
   * valid in sequence; only its date is checked ('dateOutOfRange' submits nothing).
   */
  createBaitSite(site: NewBaitSite): Promise<SubmitOutcome | DateOutcome>
  /**
   * Checks the date window first, then the site's history with the new event in its place;
   * 'dateOutOfRange' or 'invalidSequence' submits nothing.
   */
  recordEvent(
    projectId: string,
    site: BaitSiteView,
    event: NewEvent & { readonly occurredAt: HistoryInstant | null },
  ): Promise<CommandOutcome | DateOutcome>
  /**
   * Checks the site's history without the event; 'invalidSequence' submits nothing. Rejects
   * when eventId is not in site.events: a programming error, the screen only offers events it shows.
   */
  voidEvent(projectId: string, site: BaitSiteView, eventId: string): Promise<CommandOutcome>
}

/** The species fields of the payload: only CAPTURED and IDENTIFIED carry them (ADR 0005, rule 4). */
function typedFields(event: NewEvent): { readonly speciesId: string | null; readonly identifiedEventId: string | null } {
  if (event.type === 'CAPTURED') return { speciesId: event.speciesId, identifiedEventId: null }
  if (event.type === 'IDENTIFIED') return { speciesId: event.speciesId, identifiedEventId: event.identifiedEventId }
  return { speciesId: null, identifiedEventId: null }
}

export function createLocalCommands(
  local: Pick<LocalSession, 'submit'>,
  ids: IdGenerator,
  now: () => Date,
): LocalCommands {
  /**
   * The device clock as a history instant. toISOString always gives a valid instant for a real
   * clock; if it did not, failing beats a silent fallback date.
   */
  function nowInstant(): HistoryInstant {
    const instant = toHistoryInstant(now().toISOString())
    if (instant === null) throw new Error('The device clock gave an instant that cannot be recorded.')
    return instant
  }

  /** null = now, at the moment of the command. */
  function occurredAtOrNow(occurredAt: HistoryInstant | null): HistoryInstant {
    return occurredAt ?? nowInstant()
  }

  /**
   * The server's date window (ADR 0005, rule 2; OccurredAtValidator), checked on the device
   * before anything is queued (decision L8 of slice F3-3a). The screens set max on the date
   * picker, but the iOS picker ignores it: without this check a future date would come back
   * rejected at the next sync, maybe days later, with "discard" as the only way out.
   * No clock tolerance here: the picker has minute precision and is never meant to reach past
   * now. null (now) is always inside. Compared as text: both sides are fixed-width instants.
   */
  function inDateWindow(occurredAt: HistoryInstant | null): boolean {
    if (occurredAt === null) return true
    return occurredAt >= EARLIEST_OCCURRED_AT && occurredAt <= nowInstant()
  }

  return {
    createProject(name) {
      // The name exactly as typed: the name rules live on the server.
      return local.submit({ kind: 'createProject', projectId: ids.newId(), name })
    },

    // async: a throw (the clock) becomes a rejection, like every other failure of a command.
    async createBaitSite(site) {
      if (!inDateWindow(site.occurredAt)) return 'dateOutOfRange'
      // The site's id first, then its INSTALLED's.
      const baitSiteId = ids.newId()
      const installationId = ids.newId()
      return local.submit({
        kind: 'createBaitSite',
        projectId: site.projectId,
        baitSiteId,
        // Exactly as typed, like a project name: the name rules live on the server.
        name: site.name,
        latitude: site.latitude,
        longitude: site.longitude,
        locationAccuracyM: site.locationAccuracyM,
        installation: { id: installationId, occurredAt: occurredAtOrNow(site.occurredAt) },
      })
    },

    async recordEvent(projectId, site, event) {
      // The date first: a future date is refused for what it is, even when the sequence would
      // also be refused, so the screen names the real problem.
      if (!inDateWindow(event.occurredAt)) return 'dateOutOfRange'
      // Born before the sequence check: with the same occurredAt, the id decides the event's place.
      const eventId = ids.newId()
      const occurredAt = occurredAtOrNow(event.occurredAt)
      const { speciesId, identifiedEventId } = typedFields(event)
      if (checkNewEvent(site, { id: eventId, type: event.type, occurredAt, identifiedEventId }) !== 'ok') {
        return 'invalidSequence'
      }
      return local.submit({
        kind: 'recordEvent',
        projectId,
        baitSiteId: site.id,
        eventId,
        type: event.type,
        occurredAt,
        speciesId,
        identifiedEventId,
      })
    },

    async voidEvent(projectId, site, eventId) {
      const check = checkVoid(site, eventId)
      if (check === 'notFound') throw new Error('The event to void is not in the history of this bait site.')
      if (check === 'invalidSequence') return 'invalidSequence'
      return local.submit({ kind: 'voidEvent', projectId, baitSiteId: site.id, eventId })
    },
  }
}
