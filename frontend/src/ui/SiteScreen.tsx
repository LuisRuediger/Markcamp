import { useSyncExternalStore } from 'react'
import { recordableEventTypes, type RecordableType } from '../core/baitSiteRules'
import type { LocalCommands } from '../core/localCommands'
import type { EventView, ProjectView } from '../core/localMerge'
import type { LocalSession } from '../core/localSession'
import type { LocalSpecies, Observable } from '../core/localStore'
import { formatDayMonthTime } from './dateTime'
import { ptBR } from './i18n/pt-BR'
import RejectionActions from './RejectionActions'
import { rejectionText, siteSummary } from './siteText'
import VoidActions from './VoidActions'

// One bait site (decision L3 of slice F3-3a): its status, its rejected item, one button per
// event type that can be recorded now, and its history, newest first, each row with "Anular".
// Reads only the project's merged view; its writes are commands.voidEvent, local.retry and
// local.discard. No sync bar and no "Sair" (decision K2).

interface SiteScreenProps {
  projectId: string
  baitSiteId: string
  /** From the local session's per-project cache, like the Project screen. */
  view: Observable<ProjectView>
  local: Pick<LocalSession, 'retry' | 'discard'>
  commands: Pick<LocalCommands, 'voidEvent'>
  onBack: () => void
  onRecord: (type: RecordableType) => void
}

/** "Captura · 12/11, 15:30 · Jataí · aguardando envio". */
function eventSummary(event: EventView, species: readonly LocalSpecies[]): string {
  const parts: string[] = [ptBR.sites.eventTypes[event.type], formatDayMonthTime(event.occurredAt)]
  if (event.speciesId !== null) {
    // Nothing when not found (the catalogue was never synced, or the species is not in it yet).
    const found = species.find((candidate) => candidate.id === event.speciesId)
    if (found !== undefined) parts.push(found.commonName)
  }
  if (event.pending) parts.push(ptBR.sites.pendingMark)
  return parts.join(' · ')
}

function SiteScreen({ projectId, baitSiteId, view, local, commands, onBack, onRecord }: SiteScreenProps) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot)

  function renderBody() {
    switch (snapshot.status) {
      case 'loading':
        return <p>{ptBR.sites.loadingSite}</p>
      case 'ready': {
        const { project, baitSites, species } = snapshot.value
        const site = project === null ? undefined : baitSites.find((candidate) => candidate.id === baitSiteId)
        if (project === null || site === undefined) return <h1>{ptBR.sites.siteNotFound}</h1>

        // A rejected item blocks every later item of the same site (decision E2 of slice F2c),
        // so anything recorded or voided now would only pile up behind it. The project first:
        // everything in a rejected project is blocked behind it.
        const blocked =
          project.rejection !== null ? ptBR.sites.projectRejected : site.rejection !== null ? ptBR.sites.siteBlocked : null
        // Empty when the history is invalid: the status line already says so, and voiding
        // (still offered below) is how it gets fixed.
        const types = blocked === null ? recordableEventTypes(site) : []
        // Newest first: the view is already in history order, so reversed, never sorted here.
        const history = site.events.toReversed()

        return (
          <>
            <h1>{site.name}</h1>
            <p>{siteSummary(site)}</p>
            {site.rejection !== null && (
              <RejectionActions
                key={site.rejection.seq}
                text={rejectionText(site.rejection)}
                seq={site.rejection.seq}
                local={local}
              />
            )}

            {(blocked !== null || types.length > 0) && (
              <>
                <h2>{ptBR.sites.recordHeading}</h2>
                {blocked !== null ? (
                  <p>{blocked}</p>
                ) : (
                  <div className="record-types">
                    {types.map((type) => (
                      <button key={type} type="button" onClick={() => onRecord(type)}>
                        {ptBR.sites.eventTypes[type]}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <h2>{ptBR.sites.historyHeading}</h2>
            {history.length === 0 ? (
              <p>{ptBR.sites.emptyHistory}</p>
            ) : (
              <ul className="history">
                {history.map((event) => (
                  <li key={event.id}>
                    <span>{eventSummary(event, species)}</span>
                    {/* site, not a copy from when the row appeared: the view as it is at the tap. */}
                    {blocked === null && <VoidActions onVoid={() => commands.voidEvent(projectId, site, event.id)} />}
                  </li>
                ))}
              </ul>
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

export default SiteScreen
