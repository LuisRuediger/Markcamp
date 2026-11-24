import { useSyncExternalStore } from 'react'
import type { BaitSiteView, ProjectView } from '../core/localMerge'
import type { LocalSession } from '../core/localSession'
import type { Observable } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'
import RejectionActions from './RejectionActions'
import { rejectionText, siteSummary } from './siteText'
import StatusMark from './StatusMark'

// One project's bait sites (decision K3 of slice F3-2), the "Lista" of the bottom bar. Reads
// only the project's merged view; its only writes are local.retry and local.discard. No sync
// bar: syncing is automatic, and each row says whether it is still waiting to be sent. No
// "Voltar" and no "Novo ponto": the bottom bar has Projetos and the + (decision R7 of slice F4-1).

interface ProjectScreenProps {
  /** From the local session's per-project cache: the same object while the session lasts. */
  view: Observable<ProjectView>
  local: Pick<LocalSession, 'retry' | 'discard'>
  onOpenSite: (baitSiteId: string) => void
}

function SiteRow({ site, local, onOpen }: { site: BaitSiteView; local: ProjectScreenProps['local']; onOpen: () => void }) {
  const { rejection } = site

  // Only the name is a button: the row also holds the rejection buttons, and a button inside
  // a button is invalid HTML. The mark is beside the button, not in it, so the button's
  // accessible name stays the site's name.
  return (
    <li>
      <StatusMark replay={site.replay} />
      <button type="button" onClick={onOpen}>
        {site.name}
      </button>
      <span> · {siteSummary(site)}</span>
      {rejection !== null && (
        <RejectionActions key={rejection.seq} text={rejectionText(rejection)} seq={rejection.seq} local={local} />
      )}
    </li>
  )
}

function ProjectScreen({ view, local, onOpenSite }: ProjectScreenProps) {
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
                  <SiteRow key={site.id} site={site} local={local} onOpen={() => onOpenSite(site.id)} />
                ))}
              </ul>
            )}
            {/* Everything of a rejected project is blocked behind it (decision E2 of slice F2c),
                so the bar's + is disabled; this says why. */}
            {project.rejection !== null && <p>{ptBR.sites.projectRejected}</p>}
          </>
        )
      }
    }
  }

  return <main>{renderBody()}</main>
}

export default ProjectScreen
