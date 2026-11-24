import { useMemo, useSyncExternalStore } from 'react'
import type { BaitSiteView, ProjectListEntry, ProjectView } from '../core/localMerge'
import type { Observable } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'
import LeafletMap from './map/LeafletMap'
import { mapMarkers, type MapView } from './map/mapMarkers'

// The map of one project, the app's main screen (decision M1-c of slice F4-1). Reads only the
// project's merged view, like the Project screen; it writes nothing. The bottom bar is not
// part of it: App puts it under the screens that have it.

export interface MapScreenProps {
  /** From the local session's per-project cache: the same object while the session lasts. */
  view: Observable<ProjectView>
  /** Thunderforest API key, from main.tsx through App. */
  tileApiKey: string
  /** Where the user left this project's map while the app was open; null fits every site. */
  savedView: MapView | null
  onViewChange: (view: MapView) => void
  onOpenSite: (baitSiteId: string) => void
}

/** The design's logo: a honey hexagon with a location pin. Decorative: "MarkCamp" is next to it. */
function Logo() {
  return (
    <svg className="map-header__logo" viewBox="0 0 36 36" width="38" height="38" aria-hidden="true">
      <polygon points="18,1 32.7,9.5 32.7,26.5 18,35 3.3,26.5 3.3,9.5" fill="var(--color-honey)" />
      <path
        d="M18 8.5a6.5 6.5 0 0 0-6.5 6.5c0 4.8 6.5 11.5 6.5 11.5s6.5-6.7 6.5-11.5A6.5 6.5 0 0 0 18 8.5z"
        fill="var(--color-text)"
      />
      <circle cx="18" cy="15" r="2.4" fill="var(--color-honey)" />
    </svg>
  )
}

type ProjectMapProps = Omit<MapScreenProps, 'view'> & {
  project: ProjectListEntry
  baitSites: readonly BaitSiteView[]
}

function ProjectMap({ project, baitSites, tileApiKey, savedView, onViewChange, onOpenSite }: ProjectMapProps) {
  // Same array while the sites do not change: the map then has nothing to synchronise.
  const markers = useMemo(() => mapMarkers(baitSites), [baitSites])

  return (
    <main className="map-screen">
      <LeafletMap
        markers={markers}
        tileApiKey={tileApiKey}
        startView={savedView}
        onSelect={onOpenSite}
        onViewChange={onViewChange}
      />
      <header className="map-header">
        <Logo />
        <div className="map-header__text">
          <h1 className="map-header__title">{ptBR.appTitle}</h1>
          <p className="map-header__project">
            {project.name} · {ptBR.map.siteCount(baitSites.length)}
          </p>
        </div>
      </header>
      {baitSites.length === 0 && <p className="map-empty">{ptBR.map.empty}</p>}
    </main>
  )
}

function MapScreen({ view, ...rest }: MapScreenProps) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot)

  switch (snapshot.status) {
    case 'loading':
      return (
        <main>
          <p>{ptBR.sites.loading}</p>
        </main>
      )
    case 'ready': {
      const { project, baitSites } = snapshot.value
      if (project === null) {
        return (
          <main>
            <h1>{ptBR.sites.projectNotFound}</h1>
          </main>
        )
      }
      // The map is created only now, with the sites already known: its starting view fits them.
      return <ProjectMap project={project} baitSites={baitSites} {...rest} />
    }
  }
}

export default MapScreen
