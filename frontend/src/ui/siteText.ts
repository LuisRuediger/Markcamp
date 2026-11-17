import { effectiveSpeciesId, hasPendingChanges } from '../core/baitSiteRules'
import type { ReplayResult } from '../core/baitSiteStateMachine'
import type { BaitSiteRejection, BaitSiteView, EventView } from '../core/localMerge'
import type { LocalSpecies } from '../core/localStore'
import { formatDayMonth, formatDayMonthTime } from './dateTime'
import { ptBR } from './i18n/pt-BR'

// Words for a bait site, shared by the Project screen's row and the Site screen, so the two
// cannot say different things about the same site.

function statusText(replay: ReplayResult): string {
  // Should not happen (the device checks every event before queueing it), but shown, not hidden.
  return replay.valid ? ptBR.sites.status[replay.status] : ptBR.sites.invalidHistory
}

/** "Armada · desde 03/11 · aguardando envio": status, date of the last event, pending mark. */
export function siteSummary(site: BaitSiteView): string {
  // site.events is in history order: the last one is the latest.
  const last = site.events.at(-1)
  const details = [statusText(site.replay)]
  if (last !== undefined) details.push(ptBR.sites.since(formatDayMonth(last.occurredAt)))
  // Not next to a rejection: the rejection says more, like the project row.
  if (site.rejection === null && hasPendingChanges(site)) details.push(ptBR.sites.pendingMark)
  return details.join(' · ')
}

/** The common name of a species id; nothing when not found (catalogue never synced, or the species not in it yet). */
function speciesName(speciesId: string | null, species: readonly LocalSpecies[]): string | null {
  if (speciesId === null) return null
  return species.find((candidate) => candidate.id === speciesId)?.commonName ?? null
}

/**
 * A history row: "Captura · 12/11, 15:30 · Jataí · aguardando envio". A capture shows the
 * species that counts (effectiveSpeciesId); an identification adds the capture it refers to,
 * "Identificação · 17/11, 19:30 · Jataí · captura de 12/11".
 */
export function eventSummary(site: BaitSiteView, event: EventView, species: readonly LocalSpecies[]): string {
  const parts: string[] = [ptBR.sites.eventTypes[event.type], formatDayMonthTime(event.occurredAt)]
  const name = speciesName(event.type === 'CAPTURED' ? effectiveSpeciesId(site, event) : event.speciesId, species)
  if (name !== null) parts.push(name)
  if (event.type === 'IDENTIFIED') {
    // Nothing when not found: in a valid history the target is always among site.events.
    const target = site.events.find((candidate) => candidate.id === event.identifiedEventId)
    if (target !== undefined) parts.push(ptBR.sites.captureOf(formatDayMonth(target.occurredAt)))
  }
  if (event.pending) parts.push(ptBR.sites.pendingMark)
  return parts.join(' · ')
}

/** What the server refused, naming the event when it is known. */
export function rejectionText(rejection: BaitSiteRejection): string {
  const { event } = rejection
  const described = event === null ? null : ptBR.sites.eventAt(ptBR.sites.eventTypes[event.type], formatDayMonthTime(event.occurredAt))
  switch (rejection.kind) {
    case 'createBaitSite':
      return ptBR.sites.rejectedSite
    case 'recordEvent':
      return described === null ? ptBR.sites.rejectedUnknown : ptBR.sites.rejectedRecord(described)
    case 'voidEvent':
      return described === null ? ptBR.sites.rejectedUnknown : ptBR.sites.rejectedVoid(described)
  }
}
