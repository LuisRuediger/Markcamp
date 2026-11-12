import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { LocalCommands } from '../core/localCommands'
import type { LocalSession, LocalSessionSnapshot } from '../core/localSession'
import type { GeolocationPort } from '../core/ports'
import type { SessionIdentitySource, SessionStore } from '../core/sessionStore'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'
import NewSiteScreen from './NewSiteScreen'
import ProjectScreen from './ProjectScreen'
import SignInScreen from './SignInScreen'

// Never getIdentity: the uid must not reach ui.
type AppStore = SessionStore & Pick<SessionIdentitySource, 'retryBackendCheck'>

interface AppProps {
  store: AppStore
  local: LocalSession
  commands: LocalCommands
  /** Read once per run in main.tsx (ADR 0008, decision 11). */
  installed: boolean
  /** Used only by the New site screen, which starts and stops it. */
  geolocation: GeolocationPort
}

type ReadySnapshot = Extract<LocalSessionSnapshot, { readonly status: 'ready' }>

// Navigation (decision J2 of slice F3): three screens kept in memory, no router.
type Screen =
  | { readonly kind: 'projects' }
  | { readonly kind: 'project'; readonly projectId: string }
  | { readonly kind: 'newSite'; readonly projectId: string; readonly suggestedName: string }

const PROJECTS: Screen = { kind: 'projects' }

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

type ReadyProps = Omit<AppProps, 'installed'> & { email: string | null; snapshot: ReadySnapshot }

function Ready({ store, local, commands, geolocation, email, snapshot }: ReadyProps) {
  // The screen is kept with the snapshot it belongs to. A new ready snapshot (another
  // session) starts at Projects: whoever signs in never lands on the previous session's project.
  const [nav, setNav] = useState<{ readonly snapshot: ReadySnapshot; readonly screen: Screen }>({
    snapshot,
    screen: PROJECTS,
  })
  const screen = nav.snapshot === snapshot ? nav.screen : PROJECTS
  const go = (next: Screen) => setNav({ snapshot, screen: next })

  switch (screen.kind) {
    case 'projects':
      return (
        <HomeScreen
          store={store}
          local={local}
          commands={commands}
          email={email}
          projects={snapshot.projects}
          pendingCount={snapshot.pendingCount}
          sync={snapshot.sync}
          onOpenProject={(projectId) => go({ kind: 'project', projectId })}
        />
      )
    case 'project':
      return (
        <ProjectScreen
          view={snapshot.project(screen.projectId)}
          local={local}
          onBack={() => go(PROJECTS)}
          onNewSite={(suggestedName) => go({ kind: 'newSite', projectId: screen.projectId, suggestedName })}
        />
      )
    case 'newSite': {
      const back = () => go({ kind: 'project', projectId: screen.projectId })
      return (
        <NewSiteScreen
          projectId={screen.projectId}
          suggestedName={screen.suggestedName}
          geolocation={geolocation}
          commands={commands}
          onBack={back}
          onSaved={back}
        />
      )
    }
  }
}

function SignedIn({ store, local, commands, geolocation, email }: Omit<AppProps, 'installed'> & { email: string | null }) {
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
        <Ready store={store} local={local} commands={commands} geolocation={geolocation} email={email} snapshot={snapshot} />
      )
  }
}

function Body({ store, local, commands, geolocation }: Omit<AppProps, 'installed'>) {
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
      return <SignedIn store={store} local={local} commands={commands} geolocation={geolocation} email={session.email} />
  }
}

function App({ store, local, commands, installed, geolocation }: AppProps) {
  return (
    <>
      {/* In every state: on the iPhone a sign-in done in a Safari tab does not carry into
          the installed app, so installing first avoids doing it twice. Not dismissible. */}
      {!installed && <p className="install-banner">{ptBR.installBanner}</p>}
      <Body store={store} local={local} commands={commands} geolocation={geolocation} />
    </>
  )
}

export default App
