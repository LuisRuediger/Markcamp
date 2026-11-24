import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RecordableType } from '../core/baitSiteRules'
import type { LocalCommands } from '../core/localCommands'
import type { LocalSession, LocalSessionSnapshot } from '../core/localSession'
import type { GeolocationPort } from '../core/ports'
import type { SessionIdentitySource, SessionStore } from '../core/sessionStore'
import BottomNav, { type NavTab } from './BottomNav'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'
import type { MapView } from './map/mapMarkers'
import MapScreen from './MapScreen'
import NewSiteScreen from './NewSiteScreen'
import ProjectScreen from './ProjectScreen'
import RecordEventScreen from './RecordEventScreen'
import SignInScreen from './SignInScreen'
import SiteScreen from './SiteScreen'

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
  /** Thunderforest API key (decision R3 of slice F4-1), passed down to the map only. */
  tileApiKey: string
}

type ReadySnapshot = Extract<LocalSessionSnapshot, { readonly status: 'ready' }>

// Navigation (decisions J2 of slice F3, L2 of slice F3-3a, R6 and R7 of slice F4-1): screens
// kept in memory, no router. Map, List and Projects have the bottom bar; New site, Site and
// Record have "Voltar", which goes back to the screen they were opened from (`from`). Record
// keeps its site's `from`, so the Site screen it returns to still knows its own way back.
type SiteOrigin = 'map' | 'list'
type Screen =
  | { readonly kind: 'projects' }
  | { readonly kind: 'map'; readonly projectId: string }
  | { readonly kind: 'list'; readonly projectId: string }
  | { readonly kind: 'newSite'; readonly projectId: string; readonly suggestedName: string; readonly from: NavTab }
  | { readonly kind: 'site'; readonly projectId: string; readonly baitSiteId: string; readonly from: SiteOrigin }
  | {
      readonly kind: 'record'
      readonly projectId: string
      readonly baitSiteId: string
      readonly type: RecordableType
      readonly from: SiteOrigin
    }

const PROJECTS: Screen = { kind: 'projects' }

/** The bar screen of a tab, for the current project. */
function tabScreen(tab: NavTab, projectId: string): Screen {
  return tab === 'projects' ? PROJECTS : { kind: tab, projectId }
}

/** Everything navigation keeps in memory while the app is open, for one local session. */
interface Nav {
  readonly snapshot: ReadySnapshot
  readonly screen: Screen
  /** The project Mapa, Lista and + act on: the last one opened. null until one is. */
  readonly currentProjectId: string | null
  /**
   * The map's centre and zoom as the user left it, with the project it belongs to: reopening
   * that project's map restores it; another project's map starts from its sites. Memory only,
   * never stored on the device.
   */
  readonly mapView: { readonly projectId: string; readonly view: MapView } | null
}

function startNav(snapshot: ReadySnapshot): Nav {
  return { snapshot, screen: PROJECTS, currentProjectId: null, mapView: null }
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

type ReadyProps = Omit<AppProps, 'installed'> & { email: string | null; snapshot: ReadySnapshot }

function Ready({ store, local, commands, geolocation, tileApiKey, email, snapshot }: ReadyProps) {
  // Navigation is kept with the snapshot it belongs to. A new ready snapshot (another
  // session) starts at Projects, with no current project and no saved map view: whoever
  // signs in never lands on the previous session's project.
  const [nav, setNav] = useState<Nav>(() => startNav(snapshot))
  const state = nav.snapshot === snapshot ? nav : startNav(snapshot)
  const { screen, currentProjectId } = state
  const update = (change: (current: Nav) => Partial<Omit<Nav, 'snapshot'>>) =>
    setNav((previous) => {
      const current = previous.snapshot === snapshot ? previous : startNav(snapshot)
      return { ...current, ...change(current) }
    })
  // Every screen but Projects belongs to a project, which becomes the current one.
  const go = (next: Screen) =>
    update((current) => ({
      screen: next,
      currentProjectId: next.kind === 'projects' ? current.currentProjectId : next.projectId,
    }))

  /** A bar screen: the content, then the bar acting on the current project. */
  const withNav = (tab: NavTab, content: ReactNode) => (
    <div className="with-bottom-nav">
      {content}
      <BottomNav
        current={tab}
        project={currentProjectId === null ? null : snapshot.project(currentProjectId)}
        onMap={() => {
          if (currentProjectId !== null) go({ kind: 'map', projectId: currentProjectId })
        }}
        onList={() => {
          if (currentProjectId !== null) go({ kind: 'list', projectId: currentProjectId })
        }}
        onProjects={() => go(PROJECTS)}
        onNewSite={(suggestedName) => {
          if (currentProjectId !== null) go({ kind: 'newSite', projectId: currentProjectId, suggestedName, from: tab })
        }}
      />
    </div>
  )

  switch (screen.kind) {
    case 'projects':
      return withNav(
        'projects',
        <HomeScreen
          store={store}
          local={local}
          commands={commands}
          email={email}
          projects={snapshot.projects}
          pendingCount={snapshot.pendingCount}
          sync={snapshot.sync}
          onOpenProject={(projectId) => go({ kind: 'map', projectId })}
        />,
      )
    case 'map': {
      const { projectId } = screen
      const saved = state.mapView
      return withNav(
        'map',
        // Keyed by project: another project's map is another Leaflet map, with its own start.
        <MapScreen
          key={projectId}
          view={snapshot.project(projectId)}
          tileApiKey={tileApiKey}
          savedView={saved !== null && saved.projectId === projectId ? saved.view : null}
          onViewChange={(view) => update(() => ({ mapView: { projectId, view } }))}
          onOpenSite={(baitSiteId) => go({ kind: 'site', projectId, baitSiteId, from: 'map' })}
        />,
      )
    }
    case 'list': {
      const { projectId } = screen
      return withNav(
        'list',
        <ProjectScreen
          view={snapshot.project(projectId)}
          local={local}
          onOpenSite={(baitSiteId) => go({ kind: 'site', projectId, baitSiteId, from: 'list' })}
        />,
      )
    }
    case 'newSite': {
      const back = () => go(tabScreen(screen.from, screen.projectId))
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
    case 'site': {
      const { projectId, baitSiteId, from } = screen
      return (
        <SiteScreen
          projectId={projectId}
          baitSiteId={baitSiteId}
          view={snapshot.project(projectId)}
          local={local}
          commands={commands}
          onBack={() => go(tabScreen(from, projectId))}
          onRecord={(type) => go({ kind: 'record', projectId, baitSiteId, type, from })}
        />
      )
    }
    case 'record': {
      const { projectId, baitSiteId, from } = screen
      const back = () => go({ kind: 'site', projectId, baitSiteId, from })
      return (
        <RecordEventScreen
          projectId={projectId}
          baitSiteId={baitSiteId}
          type={screen.type}
          view={snapshot.project(projectId)}
          commands={commands}
          onBack={back}
          onSaved={back}
        />
      )
    }
  }
}

function SignedIn({ store, local, commands, geolocation, tileApiKey, email }: Omit<AppProps, 'installed'> & { email: string | null }) {
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
        <Ready
          store={store}
          local={local}
          commands={commands}
          geolocation={geolocation}
          tileApiKey={tileApiKey}
          email={email}
          snapshot={snapshot}
        />
      )
  }
}

function Body({ store, local, commands, geolocation, tileApiKey }: Omit<AppProps, 'installed'>) {
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
      return (
        <SignedIn
          store={store}
          local={local}
          commands={commands}
          geolocation={geolocation}
          tileApiKey={tileApiKey}
          email={session.email}
        />
      )
  }
}

function App({ store, local, commands, installed, geolocation, tileApiKey }: AppProps) {
  return (
    <>
      {/* In every state: on the iPhone a sign-in done in a Safari tab does not carry into
          the installed app, so installing first avoids doing it twice. Not dismissible. */}
      {!installed && <p className="install-banner">{ptBR.installBanner}</p>}
      <Body store={store} local={local} commands={commands} geolocation={geolocation} tileApiKey={tileApiKey} />
    </>
  )
}

export default App
