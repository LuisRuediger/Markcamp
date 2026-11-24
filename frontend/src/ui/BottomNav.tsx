import { useSyncExternalStore, type ReactNode } from 'react'
import { suggestBaitSiteName } from '../core/baitSiteRules'
import type { ProjectView } from '../core/localMerge'
import type { Observable } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'

// The bottom bar of the Map, List, Projects and Settings screens (decision R7 of slice F4-1,
// T2 of slice F4-2a): Mapa, Lista, a large + in the middle, Projetos and Ajustes. Mapa and
// Lista act on the current project, the last one opened. The + does the action of the screen
// it is on (decision T6-b): on Projetos it opens "Novo projeto", always enabled (the first-use
// path); everywhere else it opens "Novo ponto" on the current project. The only data it reads
// is that project's view, for "Novo ponto" (decision K3: a rejected project gets no new sites).

export type NavTab = 'map' | 'list' | 'projects' | 'settings'

export interface BottomNavProps {
  current: NavTab
  /** The current project's view, or null while no project was opened yet. */
  project: Observable<ProjectView> | null
  onMap: () => void
  onList: () => void
  onProjects: () => void
  onSettings: () => void
  /** The + on Mapa, Lista and Ajustes: "Isca N", computed from the current project's sites at the tap. */
  onNewSite: (suggestedName: string) => void
  /** The + on Projetos. */
  onNewProject: () => void
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

const SETTINGS_ICON = (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
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

/** The + itself. Its accessible name says what it does on this screen. */
function PlusButton({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" className="bottom-nav__plus" aria-label={label} disabled={disabled} onClick={onClick}>
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
      label={ptBR.sites.newSite}
      disabled={!canCreate}
      onClick={() => {
        if (canCreate) onNewSite(suggestBaitSiteName(view.baitSites.map((site) => site.name)))
      }}
    />
  )
}

function CenterButton({ current, project, onNewSite, onNewProject }: Pick<BottomNavProps, 'current' | 'project' | 'onNewSite' | 'onNewProject'>) {
  // By screen, not by state: on Projetos the + never reads the project's view.
  if (current === 'projects') return <PlusButton label={ptBR.projects.newProject} disabled={false} onClick={onNewProject} />
  if (project === null) return <PlusButton label={ptBR.sites.newSite} disabled onClick={() => {}} />
  return <ProjectPlusButton project={project} onNewSite={onNewSite} />
}

function BottomNav({ current, project, onMap, onList, onProjects, onSettings, onNewSite, onNewProject }: BottomNavProps) {
  const none = project === null
  return (
    <nav className="bottom-nav">
      <Item tab="map" current={current} label={ptBR.nav.map} icon={MAP_ICON} disabled={none} onClick={onMap} />
      <Item tab="list" current={current} label={ptBR.nav.list} icon={LIST_ICON} disabled={none} onClick={onList} />
      <div className="bottom-nav__center">
        <CenterButton current={current} project={project} onNewSite={onNewSite} onNewProject={onNewProject} />
      </div>
      <Item tab="projects" current={current} label={ptBR.nav.projects} icon={PROJECTS_ICON} disabled={false} onClick={onProjects} />
      <Item tab="settings" current={current} label={ptBR.nav.settings} icon={SETTINGS_ICON} disabled={false} onClick={onSettings} />
    </nav>
  )
}

export default BottomNav
