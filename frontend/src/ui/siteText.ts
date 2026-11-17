import { hasPendingChanges } from '../core/baitSiteRules'
import type { ReplayResult } from '../core/baitSiteStateMachine'
import type { BaitSiteRejection, BaitSiteView } from '../core/localMerge'
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
