import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import type { BaitSiteView, ProjectListEntry, ProjectView } from '../core/localMerge'
import type { Observable } from '../core/localStore'
import type { GeolocationPort } from '../core/ports'
import { ptBR } from './i18n/pt-BR'
import LeafletMap, { type LeafletMapHandle } from './map/LeafletMap'
import { mapMarkers, type MapView } from './map/mapMarkers'
import { usePosition } from './map/usePosition'

// The map of one project, the app's main screen (decision M1-c of slice F4-1). Reads only the
// project's merged view, like the Project screen; it writes nothing. The bottom bar is not
// part of it: App puts it under the screens that have it. While it is open (and the page is
// visible) it watches the device's position, kept in memory only (slice F4-3).

/** How long the "location blocked" warning stays after a tap on the centre button. */
const BLOCKED_WARNING_MS = 6000

export interface MapScreenProps {
  /** From the local session's per-project cache: the same object while the session lasts. */
  view: Observable<ProjectView>
  /** Thunderforest API key, from main.tsx through App. */
  tileApiKey: string
  /** Where the user left this project's map while the app was open; null fits every site. */
  savedView: MapView | null
  onViewChange: (view: MapView) => void
  onOpenSite: (baitSiteId: string) => void
  /** Watched while this screen is mounted and the page is visible. */
  geolocation: GeolocationPort
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

/** The design's crosshair. Decorative: the button has the name. */
function Crosshair() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </svg>
  )
}

type ProjectMapProps = Omit<MapScreenProps, 'view'> & {
  project: ProjectListEntry
  baitSites: readonly BaitSiteView[]
}

function ProjectMap({ project, baitSites, tileApiKey, savedView, geolocation, onViewChange, onOpenSite }: ProjectMapProps) {
  // Same array while the sites do not change: the map then has nothing to synchronise.
  const markers = useMemo(() => mapMarkers(baitSites), [baitSites])
  const position = usePosition(geolocation)
  // The same object until the next usable reading: the map moves the dot only then.
  const reading = position.status === 'located' ? position.reading : null
  const mapRef = useRef<LeafletMapHandle>(null)

  // The map opens on the position (decision U5-b of slice F4-3): once per mount, on the first
  // reading, only if the map started with no saved view and the user has not moved it yet.
  // savedView as it was when the map was created: App saves every later move, the jump's too,
  // so coming back to this map later keeps that view and never jumps.
  const [startedWithoutView] = useState(savedView === null)
  const firstReadingSeen = useRef(false)
  useEffect(() => {
    if (reading === null || firstReadingSeen.current) return
    firstReadingSeen.current = true
    const map = mapRef.current
    if (!startedWithoutView || map === null || map.touchedByUser()) return
    map.centerOn(reading.latitude, reading.longitude)
  }, [reading, startedWithoutView])

  // The "location blocked" warning: only after a tap on the centre button, for 6 s or until
  // the next press on the screen outside the button. Each tap shows it again from 0.
  const [blockedShown, setBlockedShown] = useState(false)
  const blockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const centerButton = useRef<HTMLButtonElement>(null)
  const clearBlockedTimer = () => {
    if (blockedTimer.current !== null) clearTimeout(blockedTimer.current)
    blockedTimer.current = null
  }
  useEffect(() => clearBlockedTimer, [])

  function showBlocked() {
    clearBlockedTimer()
    setBlockedShown(true)
    blockedTimer.current = setTimeout(() => {
      blockedTimer.current = null
      setBlockedShown(false)
    }, BLOCKED_WARNING_MS)
  }

  // Capture: Leaflet may stop a press from bubbling, never from being captured.
  function handlePointerDownCapture(event: PointerEvent) {
    if (!blockedShown) return
    const button = centerButton.current
    if (button !== null && event.target instanceof Node && button.contains(event.target)) return
    clearBlockedTimer()
    setBlockedShown(false)
  }

  function handleCenter() {
    switch (position.status) {
      case 'located':
        mapRef.current?.centerOn(position.reading.latitude, position.reading.longitude)
        return
      case 'denied':
        // A web app cannot open the iPhone's Settings: the warning says where to go.
        showBlocked()
        return
      case 'searching':
      case 'unsupported':
        return
    }
  }

  return (
    <main className="map-screen" onPointerDownCapture={handlePointerDownCapture}>
      <LeafletMap
        ref={mapRef}
        markers={markers}
        tileApiKey={tileApiKey}
        startView={savedView}
        onSelect={onOpenSite}
        onViewChange={onViewChange}
        position={reading}
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
      {/* No GPS on this device: no button at all. */}
      {position.status !== 'unsupported' && (
        <button
          ref={centerButton}
          type="button"
          className="map-center"
          disabled={position.status === 'searching'}
          aria-label={position.status === 'searching' ? ptBR.map.centerSearching : ptBR.map.center}
          onClick={handleCenter}
        >
          <Crosshair />
        </button>
      )}
      {blockedShown && (
        <p role="status" className="map-blocked">
          {ptBR.map.locationBlocked}
        </p>
      )}
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
