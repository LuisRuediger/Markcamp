import { useState, useSyncExternalStore, type FormEvent } from 'react'
import type { LocalCommands } from '../core/localCommands'
import type { ProjectListEntry } from '../core/localMerge'
import type { LocalSession, SubmitOutcome } from '../core/localSession'
import type { Loadable, Observable } from '../core/localStore'
import type { SessionStore } from '../core/sessionStore'
import type { SyncEngine } from '../core/syncEngine'
import { syncIndicator, type SyncIndicator } from '../core/syncIndicator'
import { ptBR } from './i18n/pt-BR'

// The home screen while the local session is ready (ADR 0008). It reads only the merge view
// of confirmed copy + queue and the engine's status; its only writes are
// commands.createProject, local.retry and local.discard.

interface HomeScreenProps {
  store: Pick<SessionStore, 'signOut'>
  local: Pick<LocalSession, 'retry' | 'discard'>
  commands: LocalCommands
  email: string | null
  /** All three belong to one local session: a new session gives new objects. */
  projects: Observable<readonly ProjectListEntry[]>
  /** Queue items waiting to be sent, of every kind (not only projects). */
  pendingCount: Observable<number>
  sync: SyncEngine
}

function indicatorText(indicator: SyncIndicator): string {
  switch (indicator.kind) {
    case 'syncing':
      return ptBR.sync.syncing
    case 'offline':
      return indicator.pendingCount > 0
        ? `${ptBR.sync.offline}. ${ptBR.sync.pending(indicator.pendingCount)}`
        : ptBR.sync.offline
    case 'pending':
      return ptBR.sync.pending(indicator.pendingCount)
    case 'notYet':
      return ptBR.sync.notYet
    case 'synced':
      return ptBR.sync.synced
  }
}

function SyncBar({ sync, pending }: { sync: SyncEngine; pending: Loadable<number> }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getSnapshot)
  return (
    <>
      <p role="status">{indicatorText(syncIndicator(status, pending))}</p>
      {/* Disabled while a pass runs: visible feedback that the tap was taken. */}
      <button type="button" disabled={status.phase !== 'idle'} onClick={() => void sync.requestSync('full')}>
        {ptBR.sync.syncNow}
      </button>
    </>
  )
}

function rejectionText(code: string | null): string {
  return code === 'VALIDATION_FAILED' ? ptBR.projects.rejectedName : ptBR.projects.rejectedOther
}

function ProjectRow({ project, local }: { project: ProjectListEntry; local: HomeScreenProps['local'] }) {
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)
  const { rejection } = project

  async function change(action: () => Promise<void>) {
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    }
  }

  return (
    <li>
      <span>{project.name}</span>
      {project.pending && rejection === null && <span> · {ptBR.projects.pendingMark}</span>}
      {rejection !== null && (
        <>
          <p>{rejectionText(rejection.code)}</p>
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              void change(() => local.retry(rejection.seq))
            }}
          >
            {ptBR.retry}
          </button>
          {/* Discarding deletes the record for good: a second tap on the row confirms it. */}
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  void change(() => local.discard(rejection.seq))
                }}
              >
                {ptBR.projects.confirmDiscard}
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                {ptBR.projects.cancel}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)}>
              {ptBR.projects.discard}
            </button>
          )}
        </>
      )}
      {failed && <p role="alert">{ptBR.projects.changeFailed}</p>}
    </li>
  )
}

function HomeScreen({ store, local, commands, email, projects, pendingCount, sync }: HomeScreenProps) {
  const list = useSyncExternalStore(projects.subscribe, projects.getSnapshot)
  const pending = useSyncExternalStore(pendingCount.subscribe, pendingCount.getSnapshot)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)

  async function create() {
    setSaving(true)
    setSaveFailed(false)
    let outcome: SubmitOutcome | 'failed'
    try {
      outcome = await commands.createProject(name)
    } catch {
      outcome = 'failed'
    }
    // Only 'queued' is a success; anything else keeps the typed name and says so.
    if (outcome === 'queued') setName('')
    else setSaveFailed(true)
    setSaving(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    void create()
  }

  function renderList() {
    switch (list.status) {
      case 'loading':
        return <p>{ptBR.projects.loading}</p>
      case 'ready':
        if (list.value.length === 0) return <p>{ptBR.projects.empty}</p>
        // In the view's order: never sorted here.
        return (
          <ul>
            {list.value.map((project) => (
              <ProjectRow key={project.id} project={project} local={local} />
            ))}
          </ul>
        )
    }
  }

  return (
    <main>
      <h1>{ptBR.appTitle}</h1>
      <p>{email === null ? ptBR.home.signedIn : ptBR.home.signedInAs(email)}</p>
      <button type="button" onClick={() => void store.signOut()}>
        {ptBR.home.signOut}
      </button>

      <SyncBar sync={sync} pending={pending} />

      <h2>{ptBR.projects.title}</h2>
      {renderList()}

      <form onSubmit={handleSubmit}>
        <label>
          {ptBR.projects.nameLabel}
          {/* required only: the name rules (Unicode spaces, control characters, length in
              code points) belong to the server, and a copy here would drift. */}
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {/* Disabled while saving: a double tap would queue two projects with two ids. */}
        <button type="submit" disabled={saving}>
          {ptBR.projects.create}
        </button>
      </form>
      {saveFailed && <p role="alert">{ptBR.projects.saveFailed}</p>}
    </main>
  )
}

export default HomeScreen
