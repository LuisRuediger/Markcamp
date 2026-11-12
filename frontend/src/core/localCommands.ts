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
  /** New site id + its INSTALLED id; submits one createBaitSite item. A first INSTALLED is always valid. */
  createBaitSite(site: NewBaitSite): Promise<SubmitOutcome>
  /** Checks the site's history with the new event in its place; 'invalidSequence' submits nothing. */
  recordEvent(
    projectId: string,
    site: BaitSiteView,
    event: NewEvent & { readonly occurredAt: HistoryInstant | null },
  ): Promise<CommandOutcome>
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
   * The device clock as a history instant. No date window here: the server checks occurredAt
   * (ADR 0005, rule 2) and the screens cap the date picker at now. toISOString always gives a
   * valid instant for a real clock; if it did not, failing beats a silent fallback date.
   */
  function occurredAtOrNow(occurredAt: HistoryInstant | null): HistoryInstant {
    if (occurredAt !== null) return occurredAt
    const instant = toHistoryInstant(now().toISOString())
    if (instant === null) throw new Error('The device clock gave an instant that cannot be recorded.')
    return instant
  }

  return {
    createProject(name) {
      // The name exactly as typed: the name rules live on the server.
      return local.submit({ kind: 'createProject', projectId: ids.newId(), name })
    },

    // async: a throw (the clock) becomes a rejection, like every other failure of a command.
    async createBaitSite(site) {
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
      // Born before the check: with the same occurredAt, the id decides the event's place.
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
