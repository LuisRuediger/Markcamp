import { useState, useSyncExternalStore } from 'react'
import type { Loadable, Observable } from '../core/localStore'
import type { SessionStore } from '../core/sessionStore'
import type { SyncEngine } from '../core/syncEngine'
import { syncIndicator, type SyncIndicator } from '../core/syncIndicator'
import { ptBR } from './i18n/pt-BR'

// The Ajustes screen (decision T3 of slice F4-2a): the sync status and "Sincronizar agora", the
// account with "Sair", and the version of the build. It reads only the local session's
// pending count and the engine's status; its only actions are sync.requestSync and
// store.signOut. The sync bar and "Sair" of a ready session live only here (decision Q8,
// which supersedes K2 of slice F3-2).

interface SettingsScreenProps {
  store: Pick<SessionStore, 'signOut'>
  email: string | null
  /**
   * Queue items waiting to be sent, of every kind (not only projects). It and sync belong to
   * one local session: a new session gives new objects.
   */
  pendingCount: Observable<number>
  sync: SyncEngine
  /** The build's commit hash, read in main.tsx only (decision T4). */
  appVersion: string
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

// The dot before the status text. Decorative: the text says the same thing. A new kind of
// indicator fails to compile here until it gets a colour.
const DOT_CLASS = {
  pending: 'sync-dot--waiting',
  notYet: 'sync-dot--waiting',
  syncing: 'sync-dot--syncing',
  offline: 'sync-dot--offline',
  synced: 'sync-dot--synced',
} satisfies Record<SyncIndicator['kind'], string>

function SyncBar({ sync, pending }: { sync: SyncEngine; pending: Loadable<number> }) {
  const status = useSyncExternalStore(sync.subscribe, sync.getSnapshot)
  const indicator = syncIndicator(status, pending)
  return (
    <>
      <p role="status" className="sync-status">
        <span className={`sync-dot ${DOT_CLASS[indicator.kind]}`} aria-hidden="true" />
        {indicatorText(indicator)}
      </p>
      {/* Disabled while a pass runs: visible feedback that the tap was taken. */}
      <button
        type="button"
        className="pill-button"
        disabled={status.phase !== 'idle'}
        onClick={() => void sync.requestSync('full')}
      >
        {ptBR.sync.syncNow}
      </button>
    </>
  )
}

/**
 * "Sair", confirmed on the row. Signing in again needs a connection (the Google sign-in is a
 * popup), so signing out in the field without signal leaves the app useless until there is
 * one, although the queue is kept (ADR 0004).
 */
function SignOut({ store }: { store: Pick<SessionStore, 'signOut'> }) {
  const [confirming, setConfirming] = useState(false)

  if (!confirming) {
    return (
      <button type="button" className="pill-button pill-button--alert" onClick={() => setConfirming(true)}>
        {ptBR.home.signOut}
      </button>
    )
  }
  return (
    <>
      {/* Not role="alert": a warning before a choice, not an error. */}
      <p className="notice">{ptBR.settings.signOutWarning}</p>
      <div className="button-pair">
        <button
          type="button"
          className="pill-button pill-button--danger"
          onClick={() => {
            setConfirming(false)
            void store.signOut()
          }}
        >
          {ptBR.settings.confirmSignOut}
        </button>
        <button type="button" className="pill-button" onClick={() => setConfirming(false)}>
          {ptBR.settings.cancel}
        </button>
      </div>
    </>
  )
}

function SettingsScreen({ store, email, pendingCount, sync, appVersion }: SettingsScreenProps) {
  const pending = useSyncExternalStore(pendingCount.subscribe, pendingCount.getSnapshot)

  return (
    <main className="page">
      <h1 className="page__title">{ptBR.settings.title}</h1>

      <section className="settings-section">
        <h2 className="section-heading">{ptBR.settings.syncSection}</h2>
        <div className="card settings-card">
          <SyncBar sync={sync} pending={pending} />
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-heading">{ptBR.settings.accountSection}</h2>
        <div className="card settings-card">
          <p>{email === null ? ptBR.home.signedIn : ptBR.home.signedInAs(email)}</p>
          <SignOut store={store} />
        </div>
      </section>

      <p className="app-version">{ptBR.settings.version(appVersion)}</p>
    </main>
  )
}

export default SettingsScreen
