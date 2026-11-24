import { useSyncExternalStore } from 'react'
import type { ProjectListEntry } from '../core/localMerge'
import type { LocalSession } from '../core/localSession'
import type { Observable } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'
import RejectionActions from './RejectionActions'

// The Projects screen while the local session is ready (ADR 0008): the project list only. It
// reads only the merge view of confirmed copy + queue; its only writes are local.retry and
// local.discard. Creating a project is on its own screen (the + of the bar), and the sync
// status and "Sair" are on Ajustes (decision Q8, which supersedes K2 of slice F3-2).

interface HomeScreenProps {
  local: Pick<LocalSession, 'retry' | 'discard'>
  /** Belongs to one local session: a new session gives a new object. */
  projects: Observable<readonly ProjectListEntry[]>
  /** Tapping a project's name opens its map. */
  onOpenProject: (projectId: string) => void
}

// Outline icons, decorative: the button is named by the project's name.
function RowIcon({ size, path, className }: { size: number; path: string; className: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  )
}

// The bar's Projetos icon.
const FOLDER_PATH = 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z'
const CHEVRON_PATH = 'M9 6l6 6-6 6'

function rejectionText(code: string | null): string {
  return code === 'VALIDATION_FAILED' ? ptBR.projects.rejectedName : ptBR.projects.rejectedOther
}

function ProjectRow({
  project,
  local,
  onOpen,
}: {
  project: ProjectListEntry
  local: HomeScreenProps['local']
  onOpen: () => void
}) {
  const { rejection } = project
  const pending = project.pending && rejection === null

  // The pending mark and the rejection are siblings of the button, not inside it: the
  // button's accessible name stays the project's name. The mark is drawn under the name.
  return (
    <li className="project-row">
      <button type="button" className={pending ? 'project-row__open project-row__open--noted' : 'project-row__open'} onClick={onOpen}>
        <RowIcon className="project-row__icon" size={22} path={FOLDER_PATH} />
        <span className="project-row__name">{project.name}</span>
        <RowIcon className="project-row__icon" size={18} path={CHEVRON_PATH} />
      </button>
      {pending && <span className="project-row__note">{ptBR.projects.pendingMark}</span>}
      {rejection !== null && (
        <div className="project-row__rejection">
          <RejectionActions key={rejection.seq} text={rejectionText(rejection.code)} seq={rejection.seq} local={local} />
        </div>
      )}
    </li>
  )
}

function HomeScreen({ local, projects, onOpenProject }: HomeScreenProps) {
  const list = useSyncExternalStore(projects.subscribe, projects.getSnapshot)

  function renderList() {
    switch (list.status) {
      case 'loading':
        return <p>{ptBR.projects.loading}</p>
      case 'ready':
        if (list.value.length === 0) return <p>{ptBR.projects.empty}</p>
        // In the view's order: never sorted here.
        return (
          <ul className="card project-list">
            {list.value.map((project) => (
              <ProjectRow key={project.id} project={project} local={local} onOpen={() => onOpenProject(project.id)} />
            ))}
          </ul>
        )
    }
  }

  return (
    <main className="page">
      <h1 className="page__title">{ptBR.projects.title}</h1>
      {renderList()}
    </main>
  )
}

export default HomeScreen
