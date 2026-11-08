import { useState, useSyncExternalStore, type FormEvent } from 'react'
import type { CreateProjectFailure, ProjectsStore } from '../core/projectsStore'
import type { BackendState, SessionStore } from '../core/sessionStore'
import { ptBR } from './i18n/pt-BR'

interface HomeScreenProps {
  store: SessionStore
  projects: ProjectsStore
  email: string | null
  backend: BackendState
}

const BACKEND_TEXT: Record<BackendState, string> = {
  checking: ptBR.home.backendChecking,
  ok: ptBR.home.backendOk,
  unavailable: ptBR.home.backendUnavailable,
}

function HomeScreen({ store, projects, email, backend }: HomeScreenProps) {
  const list = useSyncExternalStore(projects.subscribe, projects.getSnapshot)
  const [name, setName] = useState('')
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<CreateProjectFailure | null>(null)

  async function create() {
    setPending(true)
    setFailure(null)
    const result = await projects.create(name)
    if (result === null) setName('')
    setFailure(result)
    setPending(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void create()
  }

  return (
    <main>
      <h1>{ptBR.appTitle}</h1>
      <p>{email === null ? ptBR.home.signedIn : ptBR.home.signedInAs(email)}</p>
      <p role="status">{BACKEND_TEXT[backend]}</p>
      <button type="button" onClick={() => void store.signOut()}>
        {ptBR.home.signOut}
      </button>

      <h2>{ptBR.projects.title}</h2>
      {list.status === 'loading' && <p>{ptBR.projects.loading}</p>}
      {list.status === 'unavailable' && (
        <>
          <p>{ptBR.projects.unavailable}</p>
          <button type="button" onClick={() => void projects.reload()}>
            {ptBR.projects.retry}
          </button>
        </>
      )}
      {list.status === 'ready' &&
        (list.items.length === 0 ? (
          <p>{ptBR.projects.empty}</p>
        ) : (
          <ul>
            {list.items.map((project) => (
              <li key={project.id}>{project.name}</li>
            ))}
          </ul>
        ))}

      <form onSubmit={handleSubmit}>
        <label>
          {ptBR.projects.nameLabel}
          {/* required only: the name rules (Unicode spaces, control characters, length in
              code points) belong to the server, and a copy here would drift. */}
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        <button type="submit" disabled={pending}>
          {ptBR.projects.create}
        </button>
      </form>
      {failure !== null && <p role="alert">{ptBR.projects.errors[failure]}</p>}
    </main>
  )
}

export default HomeScreen
