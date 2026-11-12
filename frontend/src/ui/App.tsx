import { useSyncExternalStore, type ReactNode } from 'react'
import type { LocalCommands } from '../core/localCommands'
import type { LocalSession } from '../core/localSession'
import type { SessionIdentitySource, SessionStore } from '../core/sessionStore'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'
import SignInScreen from './SignInScreen'

// Never getIdentity: the uid must not reach ui.
type AppStore = SessionStore & Pick<SessionIdentitySource, 'retryBackendCheck'>

interface AppProps {
  store: AppStore
  local: LocalSession
  commands: LocalCommands
  /** Read once per run in main.tsx (ADR 0008, decision 11). */
  installed: boolean
}

/** A signed-in screen with no local data to show yet: a message, maybe an action, and sign-out. */
function LocalStatusScreen({ store, children }: { store: AppStore; children: ReactNode }) {
  return (
    <main>
      <h1>{ptBR.appTitle}</h1>
      {children}
      <button type="button" onClick={() => void store.signOut()}>
        {ptBR.home.signOut}
      </button>
    </main>
  )
}

function SignedIn({ store, local, commands, email }: Omit<AppProps, 'installed'> & { email: string | null }) {
  const snapshot = useSyncExternalStore(local.subscribe, local.getSnapshot)

  switch (snapshot.status) {
    case 'none':
    case 'opening':
      return (
        <LocalStatusScreen store={store}>
          <p>{ptBR.loading}</p>
        </LocalStatusScreen>
      )
    case 'needsFirstOnline':
      return (
        <LocalStatusScreen store={store}>
          <p>{ptBR.localSession.needsFirstOnline}</p>
          <button type="button" onClick={() => store.retryBackendCheck()}>
            {ptBR.retry}
          </button>
        </LocalStatusScreen>
      )
    case 'failed':
      // No retry: reopening the database is not supported yet.
      return (
        <LocalStatusScreen store={store}>
          <p>{ptBR.localSession.failed}</p>
        </LocalStatusScreen>
      )
    case 'ready':
      return (
        <HomeScreen
          store={store}
          local={local}
          commands={commands}
          email={email}
          projects={snapshot.projects}
          pendingCount={snapshot.pendingCount}
          sync={snapshot.sync}
        />
      )
  }
}

function Body({ store, local, commands }: Omit<AppProps, 'installed'>) {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot)

  switch (session.status) {
    case 'loading':
      return (
        <main>
          <p>{ptBR.loading}</p>
        </main>
      )
    case 'signedOut':
      return <SignInScreen store={store} notice={session.notice} />
    case 'signedIn':
      return <SignedIn store={store} local={local} commands={commands} email={session.email} />
  }
}

function App({ store, local, commands, installed }: AppProps) {
  return (
    <>
      {/* In every state: on the iPhone a sign-in done in a Safari tab does not carry into
          the installed app, so installing first avoids doing it twice. Not dismissible. */}
      {!installed && <p className="install-banner">{ptBR.installBanner}</p>}
      <Body store={store} local={local} commands={commands} />
    </>
  )
}

export default App
