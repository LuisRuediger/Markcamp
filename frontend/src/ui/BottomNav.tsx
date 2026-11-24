import { useSyncExternalStore, type ReactNode } from 'react'
import { suggestBaitSiteName } from '../core/baitSiteRules'
import type { ProjectView } from '../core/localMerge'
import type { Observable } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'

// The bottom bar of the Map, List and Projects screens (decision R7 of slice F4-1): Mapa,
// Lista, a large + in the middle, Projetos, and an empty fifth column (Ajustes arrives in
// slice F4-2; the + stays centred). Mapa, Lista and + act on the current project, the last
// one opened. The only data it reads is that project's view, for the + (decision K3: a
// rejected project gets no new sites).

export type NavTab = 'map' | 'list' | 'projects'

export interface BottomNavProps {
  current: NavTab
  /** The current project's view, or null while no project was opened yet. */
  project: Observable<ProjectView> | null
  onMap: () => void
  onList: () => void
  onProjects: () => void
  /** "Isca N", computed from the current project's sites at the tap. */
  onNewSite: (suggestedName: string) => void
}

// Outline icons, 24 px. Decorative: the label under each one names the button.
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const MAP_ICON = (
  <Icon>
    <path d="M9 4 3 6.5v13.5L9 17.5l6 2.5 6-2.5V4L15 6.5 9 4z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Icon>
)
const LIST_ICON = (
  <Icon>
    <path d="M9 6h11M9 12h11M9 18h11" />
    <path d="M4 6h.01M4 12h.01M4 18h.01" />
  </Icon>
)
const PROJECTS_ICON = (
  <Icon>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </Icon>
)

function Item({
  tab,
  current,
  label,
  icon,
  disabled,
  onClick,
}: {
  tab: NavTab
  current: NavTab
  label: string
  icon: ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="bottom-nav__item"
      aria-current={tab === current ? 'page' : undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

function PlusButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="bottom-nav__plus" aria-label={ptBR.sites.newSite} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}

/** The + of a current project: enabled only when its view is ready and it is not rejected. */
function ProjectPlusButton({ project, onNewSite }: { project: Observable<ProjectView>; onNewSite: (suggestedName: string) => void }) {
  const snapshot = useSyncExternalStore(project.subscribe, project.getSnapshot)
  const view = snapshot.status === 'ready' ? snapshot.value : null
  // A project that is gone has nowhere to put a site; a pending one accepts sites (the queue
  // sends the project first), a rejected one does not (everything is blocked behind it).
  const canCreate = view !== null && view.project !== null && view.project.rejection === null
  return (
    <PlusButton
      disabled={!canCreate}
      onClick={() => {
        if (canCreate) onNewSite(suggestBaitSiteName(view.baitSites.map((site) => site.name)))
      }}
    />
  )
}

function BottomNav({ current, project, onMap, onList, onProjects, onNewSite }: BottomNavProps) {
  const none = project === null
  return (
    <nav className="bottom-nav">
      <Item tab="map" current={current} label={ptBR.nav.map} icon={MAP_ICON} disabled={none} onClick={onMap} />
      <Item tab="list" current={current} label={ptBR.nav.list} icon={LIST_ICON} disabled={none} onClick={onList} />
      <div className="bottom-nav__center">
        {project === null ? (
          <PlusButton disabled onClick={() => {}} />
        ) : (
          <ProjectPlusButton project={project} onNewSite={onNewSite} />
        )}
      </div>
      <Item tab="projects" current={current} label={ptBR.nav.projects} icon={PROJECTS_ICON} disabled={false} onClick={onProjects} />
      {/* Ajustes, in slice F4-2. */}
      <div className="bottom-nav__slot" />
    </nav>
  )
}

export default BottomNav
