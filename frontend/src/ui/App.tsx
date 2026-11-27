import { useState, useSyncExternalStore, type ReactNode } from 'react'
import type { RecordableType } from '../core/baitSiteRules'
import type { LocalCommands } from '../core/localCommands'
import type { LocalSession, LocalSessionSnapshot } from '../core/localSession'
import type { GeolocationPort, HeadingPort } from '../core/ports'
import type { SessionIdentitySource, SessionStore } from '../core/sessionStore'
import BottomNav, { type NavTab } from './BottomNav'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'
import type { MapView } from './map/mapMarkers'
import MapScreen from './MapScreen'
import NewProjectScreen from './NewProjectScreen'
import NewSiteScreen from './NewSiteScreen'
import ProjectScreen from './ProjectScreen'
import RecordEventScreen from './RecordEventScreen'
import SettingsScreen from './SettingsScreen'
import SignInScreen from './SignInScreen'
import SiteScreen from './SiteScreen'
import { startScreen, type StartScreen } from './startScreen'

// Never getIdentity: the uid must not reach ui.
type AppStore = SessionStore & Pick<SessionIdentitySource, 'retryBackendCheck'>

interface AppProps {
  store: AppStore
  local: LocalSession
  commands: LocalCommands
  /** Read once per run in main.tsx (ADR 0008, decision 11). */
  installed: boolean
  /** Used by the Map and New site screens, each starting and stopping its own watch. */
  geolocation: GeolocationPort
  /** The compass, used by the Map screen only, which asks for it on the first tap (slice F4-5). */
  heading: HeadingPort
  /** Thunderforest API key (decision R3 of slice F4-1), passed down to the map only. */
  tileApiKey: string
  /** The build's commit hash (decision T4 of slice F4-2a), passed down to Ajustes only. */
  appVersion: string
}

type ReadySnapshot = Extract<LocalSessionSnapshot, { readonly status: 'ready' }>

// Navigation (decisions J2 of slice F3, L2 of slice F3-3a, R6 and R7 of slice F4-1, T2 and T7
// of slice F4-2a): screens kept in memory, no router. Map, List, Projects and Settings have
// the bottom bar; New site, Site and Record have "Voltar", which goes back to the screen they
// were opened from (`from`). Record keeps its site's `from`, so the Site screen it returns to
// still knows its own way back. New project opens only from Projects and goes back there.
type SiteOrigin = 'map' | 'list'
type Screen =
  | { readonly kind: 'projects' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'newProject' }
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
const SETTINGS: Screen = { kind: 'settings' }
const NEW_PROJECT: Screen = { kind: 'newProject' }

/** The bar screen of a tab, for the current project. */
function tabScreen(tab: NavTab, projectId: string): Screen {
  switch (tab) {
    case 'projects':
      return PROJECTS
    case 'settings':
      return SETTINGS
    case 'map':
    case 'list':
      return { kind: tab, projectId }
  }
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
  /**
   * The map's compass is on (decision W6 of slice F4-5): kept when the user leaves the map and
   * comes back. Memory only: reopening the app, or a new session, starts with it off.
   */
  readonly compassOn: boolean
}

/** Where a session opens, decided once per ready snapshot (slice F4-2b). Never a saved map view. */
function startNav(snapshot: ReadySnapshot, start: Exclude<StartScreen, { readonly kind: 'deciding' }>): Nav {
  switch (start.kind) {
    case 'projects':
      return { snapshot, screen: PROJECTS, currentProjectId: null, mapView: null, compassOn: false }
    case 'map':
      return {
        snapshot,
        screen: { kind: 'map', projectId: start.projectId },
        currentProjectId: start.projectId,
        mapView: null,
        compassOn: false,
      }
  }
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

function Ready({ store, local, commands, geolocation, heading, tileApiKey, appVersion, email, snapshot }: ReadyProps) {
  const lastProjectId = useSyncExternalStore(snapshot.lastProjectId.subscribe, snapshot.lastProjectId.getSnapshot)
  const projects = useSyncExternalStore(snapshot.projects.subscribe, snapshot.projects.getSnapshot)
  const start = startScreen(lastProjectId, projects)

  // Navigation is kept with the snapshot it belongs to. A new ready snapshot (another
  // session) drops the previous one's screen, current project and saved map view, and opens
  // where its own database says (slice F4-2b): whoever signs in never lands on the previous
  // session's project. The start is decided once per snapshot: stored with setNav while
  // rendering (React's "adjust state while rendering"), so a later change of the list never
  // moves the user.
  const [nav, setNav] = useState<Nav | null>(null)
  let state = nav !== null && nav.snapshot === snapshot ? nav : null
  if (state === null && start.kind !== 'deciding') {
    state = startNav(snapshot, start)
    setNav(state)
  }
  if (state === null) {
    return (
      <LocalStatusScreen store={store}>
        <p>{ptBR.loading}</p>
      </LocalStatusScreen>
    )
  }
  const { screen, currentProjectId } = state
  const update = (change: (current: Nav) => Partial<Omit<Nav, 'snapshot'>>) =>
    setNav((previous) => {
      // A handler of another session's screen changes nothing.
      if (previous === null || previous.snapshot !== snapshot) return previous
      return { ...previous, ...change(previous) }
    })
  // A screen of a project makes it the current one; Projects, Settings and New project
  // belong to no project and leave the current one as it was. A change of the current
  // project is remembered for the next start: here, not in the updater, which must stay pure
  // (StrictMode runs it twice). local.rememberProject is ui's only write outside the
  // localCommands commands, local.retry and local.discard; it never enters the queue.
  const go = (next: Screen) => {
    if ('projectId' in next && next.projectId !== currentProjectId) void local.rememberProject(next.projectId)
    update((current) => ({
      screen: next,
      currentProjectId: 'projectId' in next ? next.projectId : current.currentProjectId,
    }))
  }

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
        onSettings={() => go(SETTINGS)}
        onNewSite={(suggestedName) => {
          if (currentProjectId !== null) go({ kind: 'newSite', projectId: currentProjectId, suggestedName, from: tab })
        }}
        onNewProject={() => go(NEW_PROJECT)}
      />
    </div>
  )

  switch (screen.kind) {
    case 'projects':
      return withNav(
        'projects',
        <HomeScreen local={local} projects={snapshot.projects} onOpenProject={(projectId) => go({ kind: 'map', projectId })} />,
      )
    case 'settings':
      return withNav(
        'settings',
        <SettingsScreen
          store={store}
          email={email}
          pendingCount={snapshot.pendingCount}
          sync={snapshot.sync}
          appVersion={appVersion}
        />,
      )
    case 'newProject':
      return <NewProjectScreen commands={commands} onBack={() => go(PROJECTS)} onCreated={() => go(PROJECTS)} />
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
          geolocation={geolocation}
          heading={heading}
          compassOn={state.compassOn}
          onCompassChange={(on) => update(() => ({ compassOn: on }))}
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

function SignedIn({
  store,
  local,
  commands,
  geolocation,
  heading,
  tileApiKey,
  appVersion,
  email,
}: Omit<AppProps, 'installed'> & { email: string | null }) {
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
          heading={heading}
          tileApiKey={tileApiKey}
          appVersion={appVersion}
          email={email}
          snapshot={snapshot}
        />
      )
  }
}

function Body({ store, local, commands, geolocation, heading, tileApiKey, appVersion }: Omit<AppProps, 'installed'>) {
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
          heading={heading}
          tileApiKey={tileApiKey}
          appVersion={appVersion}
          email={session.email}
        />
      )
  }
}

function App({ store, local, commands, installed, geolocation, heading, tileApiKey, appVersion }: AppProps) {
  return (
    <>
      {/* In every state: on the iPhone a sign-in done in a Safari tab does not carry into
          the installed app, so installing first avoids doing it twice. Not dismissible. */}
      {!installed && <p className="install-banner">{ptBR.installBanner}</p>}
      <Body
        store={store}
        local={local}
        commands={commands}
        geolocation={geolocation}
        heading={heading}
        tileApiKey={tileApiKey}
        appVersion={appVersion}
      />
    </>
  )
}

export default App
