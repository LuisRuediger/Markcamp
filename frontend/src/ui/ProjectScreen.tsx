import { useSyncExternalStore } from 'react'
import type { ReplayResult } from '../core/baitSiteStateMachine'
import { hasPendingChanges, suggestBaitSiteName } from '../core/baitSiteRules'
import type { BaitSiteRejection, BaitSiteView, ProjectView } from '../core/localMerge'
import type { LocalSession } from '../core/localSession'
import type { Observable } from '../core/localStore'
import { formatDayMonth, formatDayMonthTime } from './dateTime'
import { ptBR } from './i18n/pt-BR'
import RejectionActions from './RejectionActions'

// One project's bait sites (decision K3 of slice F3-2). Reads only the project's merged view;
// its only writes are local.retry and local.discard. No sync bar: syncing is automatic, and
// each row says whether it is still waiting to be sent.

interface ProjectScreenProps {
  /** From the local session's per-project cache: the same object while the session lasts. */
  view: Observable<ProjectView>
  local: Pick<LocalSession, 'retry' | 'discard'>
  onBack: () => void
  /** "Isca N", computed from the sites on screen at the tap. */
  onNewSite: (suggestedName: string) => void
}

function statusText(replay: ReplayResult): string {
  // Should not happen (the device checks every event before queueing it), but shown, not hidden.
  return replay.valid ? ptBR.sites.status[replay.status] : ptBR.sites.invalidHistory
}

function rejectionText(rejection: BaitSiteRejection): string {
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

function SiteRow({ site, local }: { site: BaitSiteView; local: ProjectScreenProps['local'] }) {
  const { rejection } = site
  // site.events is in history order: the last one is the latest.
  const last = site.events.at(-1)
  const details = [statusText(site.replay)]
  if (last !== undefined) details.push(ptBR.sites.since(formatDayMonth(last.occurredAt)))
  // Not next to a rejection: the rejection says more, like the project row.
  if (rejection === null && hasPendingChanges(site)) details.push(ptBR.sites.pendingMark)

  // Not a button: the site screen comes in slice F3-3.
  return (
    <li>
      <strong>{site.name}</strong>
      <span> · {details.join(' · ')}</span>
      {rejection !== null && (
        <RejectionActions key={rejection.seq} text={rejectionText(rejection)} seq={rejection.seq} local={local} />
      )}
    </li>
  )
}

function ProjectScreen({ view, local, onBack, onNewSite }: ProjectScreenProps) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot)

  function renderBody() {
    switch (snapshot.status) {
      case 'loading':
        return <p>{ptBR.sites.loading}</p>
      case 'ready': {
        const { project, baitSites } = snapshot.value
        if (project === null) return <h1>{ptBR.sites.projectNotFound}</h1>
        return (
          <>
            <h1>{project.name}</h1>
            {baitSites.length === 0 ? (
              <p>{ptBR.sites.empty}</p>
            ) : (
              // In the view's order (id = creation order): never sorted here.
              <ul>
                {baitSites.map((site) => (
                  <SiteRow key={site.id} site={site} local={local} />
                ))}
              </ul>
            )}
            {/* Everything of a rejected project is blocked behind it (decision E2 of slice F2c).
                A project that is only pending accepts sites: the queue sends it first. */}
            {project.rejection === null ? (
              <button type="button" onClick={() => onNewSite(suggestBaitSiteName(baitSites.map((site) => site.name)))}>
                {ptBR.sites.newSite}
              </button>
            ) : (
              <p>{ptBR.sites.projectRejected}</p>
            )}
          </>
        )
      }
    }
  }

  return (
    <main>
      <button type="button" onClick={onBack}>
        {ptBR.nav.back}
      </button>
      {renderBody()}
    </main>
  )
}

export default ProjectScreen
