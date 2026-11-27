import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { GeoReading } from '../../core/ports'
import { initialView, type MapMarker, type MapMarkerLook, type MapView } from './mapMarkers'

// The only file that imports leaflet (decision R1 of slice F4-1, enforced in .oxlintrc.json).
// Leaflet is used directly, without a React wrapper: this component creates the map once in
// an effect, owns it, and removes it on unmount. React renders the div; Leaflet draws inside
// it. Markers are kept in sync with the `markers` prop by id, and the device's position with
// the `position` prop, so the map is never recreated because the data or the position changed.

/**
 * Thunderforest Landscape. {r} is "@2x" on retina screens. The service worker keeps these tiles
 * as they are viewed, so a place viewed once has a background offline (ADR 0007 decision 10;
 * the rule is in frontend/tileCache.ts).
 */
const TILE_URL = 'https://api.thunderforest.com/landscape/{z}/{x}/{y}{r}.png?apikey='

const ATTRIBUTION =
  '<a href="https://www.thunderforest.com/">&copy; Thunderforest</a>, ' +
  '<a href="https://www.openstreetmap.org/copyright">&copy; OpenStreetMap</a>'

/** Where a project with no site starts: the whole of Brazil. */
const BRAZIL: L.LatLngTuple = [-14.2, -51.9]
const BRAZIL_ZOOM = 4
/** Fitting every site never zooms closer than this: two sites side by side stay in context. */
const FIT_MAX_ZOOM = 17
const FIT_PADDING: L.PointTuple = [48, 48]
/** Centring on the position never leaves the map farther out than this (decision U5-b of slice F4-3). */
const CENTER_MIN_ZOOM = 17

/** The position's accuracy circle: #2563EB (--color-position) at 0.35 is rgba(37, 99, 235, 0.35). */
const ACCURACY_STYLE: L.CircleMarkerOptions = {
  color: '#2563EB',
  opacity: 0.35,
  weight: 1,
  fillColor: '#3B82F6',
  fillOpacity: 0.18,
  interactive: false,
}

const PULSE_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-6 5 12 2.5-6h6"/></svg>'
// Captured: a bee on honey (decision U4-b of slice F4-3), so no marker is blue like the position.
const BEE_ICON =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-on-honey)" ' +
  'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
  '<ellipse cx="7" cy="10.5" rx="3.4" ry="2.1" transform="rotate(-28 7 10.5)"/>' +
  '<ellipse cx="17" cy="10.5" rx="3.4" ry="2.1" transform="rotate(28 17 10.5)"/>' +
  '<circle cx="12" cy="5.6" r="2"/><ellipse cx="12" cy="14.6" rx="4.4" ry="6"/>' +
  '<path d="M7.8 13.1h8.4M7.9 16.6h8.2"/></svg>'

// Keyed by every look: a new look does not compile until it has its inner content.
const INNER = {
  empty: '',
  armed: '',
  active: PULSE_ICON,
  captured: BEE_ICON,
  lost: '',
  invalid: '<span aria-hidden="true">?</span>',
} satisfies Record<MapMarkerLook, string>

function markerIcon(look: MapMarkerLook): L.DivIcon {
  // A custom className also drops Leaflet's default white box. The div is the 48 px touch
  // area; the circle drawn inside it is smaller and lets touches through to the div.
  return L.divIcon({
    className: `map-marker map-marker--${look}`,
    html: `<span class="map-marker__dot">${INNER[look]}</span>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  })
}

interface MarkerEntry {
  readonly marker: L.Marker
  /** One function per marker: addEventListener ignores a second registration of the same one. */
  readonly onKeyDown: (event: KeyboardEvent) => void
  current: MapMarker
}

/**
 * The icon's element gets the accessible name and the keyboard handler again after every
 * setIcon: Leaflet may give it a new element (it reuses the old div for a divIcon, and then
 * the same listener is not added twice).
 */
function decorate(entry: MarkerEntry) {
  const element = entry.marker.getElement()
  if (element === undefined) return
  element.setAttribute('aria-label', entry.current.label)
  element.addEventListener('keydown', entry.onKeyDown)
}

/**
 * The device's position: a dot the size of nothing to touch. Above the site markers, but it
 * takes no touch (interactive: false, so leaflet.css lets touches through to the site under
 * it) and no focus (keyboard: false: in Leaflet 1.9.4 keyboard is independent of interactive,
 * and would add tabindex="0" and role="button").
 */
const POSITION_ICON = L.divIcon({ className: 'map-position', html: '', iconSize: [20, 20], iconAnchor: [10, 10] })

interface PositionLayers {
  readonly accuracy: L.Circle
  readonly dot: L.Marker
}

/** What a screen can ask of the map: events, not state (decision U5-b of slice F4-3). */
export interface LeafletMapHandle {
  /** Centres the map on the point, at the current zoom or CENTER_MIN_ZOOM, whichever is closer. */
  centerOn(latitude: number, longitude: number): void
  /** Whether the user has pressed, scrolled or typed on the map since it was created. */
  touchedByUser(): boolean
}

export interface LeafletMapProps {
  markers: readonly MapMarker[]
  /** Thunderforest API key, from main.tsx. Goes only into the tile URL; never logged. */
  tileApiKey: string
  /**
   * Where the map starts. Read only when the map is created; null fits every marker
   * (initialView). Later changes of this prop or of `markers` never move the map.
   */
  startView: MapView | null
  onSelect: (id: string) => void
  /** After every move or zoom after the starting view: the user's, and centerOn's. */
  onViewChange: (view: MapView) => void
  /** The device's position, drawn as a dot with its accuracy circle; null draws nothing. */
  position: GeoReading | null
  ref?: Ref<LeafletMapHandle>
}

function LeafletMap({ markers, tileApiKey, startView, onSelect, onViewChange, position, ref }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const entriesRef = useRef(new Map<string, MarkerEntry>())
  const positionRef = useRef<PositionLayers | null>(null)
  const touchedRef = useRef(false)
  // The latest props, for code that runs inside Leaflet's handlers or only at creation.
  // Updated in the first effect, so the effects below always read this render's values.
  const latest = useRef({ markers, startView, onSelect, onViewChange })

  useEffect(() => {
    latest.current = { markers, startView, onSelect, onViewChange }
  })

  // The map: created once (per key), removed on unmount. Under StrictMode, dev runs this
  // twice (create, remove, create); remove() frees the div for the second create.
  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    const map = L.map(container, {
      zoomControl: false,
      attributionControl: false,
      minZoom: 3,
      maxZoom: 18,
    })
    L.control.attribution({ prefix: false }).addTo(map)
    // Metres only, bottom left (decision V7 of slice F4-4a); styled in styles.css.
    L.control.scale({ position: 'bottomleft', metric: true, imperial: false }).addTo(map)
    // crossOrigin: a CORS request (img.crossOrigin = ''). Without it the response is opaque
    // (status 0) and the service worker refuses to keep it (decision V4 of slice F4-4a).
    L.tileLayer(TILE_URL + encodeURIComponent(tileApiKey), {
      attribution: ATTRIBUTION,
      maxZoom: 18,
      crossOrigin: true,
    }).addTo(map)

    const { markers: first, startView: saved } = latest.current
    if (saved !== null) {
      map.setView([saved.latitude, saved.longitude], saved.zoom)
    } else {
      const view = initialView(first)
      switch (view.kind) {
        case 'empty':
          map.setView(BRAZIL, BRAZIL_ZOOM)
          break
        case 'point':
          map.setView([view.latitude, view.longitude], view.zoom)
          break
        case 'bounds':
          map.fitBounds(
            [
              [view.south, view.west],
              [view.north, view.east],
            ],
            { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
          )
          break
      }
    }
    // After the starting view, so only later moves are reported: the user's and centerOn's.
    map.on('moveend', () => {
      const center = map.getCenter()
      latest.current.onViewChange({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() })
    })

    // Any press, wheel or key on the map counts as the user's (Leaflet's dragstart alone would
    // miss a pinch). On the container, so marker presses count too.
    touchedRef.current = false
    const touched = () => {
      touchedRef.current = true
    }
    container.addEventListener('pointerdown', touched)
    container.addEventListener('wheel', touched)
    container.addEventListener('keydown', touched)

    mapRef.current = map
    const entries = entriesRef.current
    return () => {
      mapRef.current = null
      // The markers and the position belonged to this map: the next one starts with none.
      entries.clear()
      positionRef.current = null
      container.removeEventListener('pointerdown', touched)
      container.removeEventListener('wheel', touched)
      container.removeEventListener('keydown', touched)
      map.remove()
    }
  }, [tileApiKey])

  useImperativeHandle(
    ref,
    (): LeafletMapHandle => ({
      centerOn(latitude, longitude) {
        const map = mapRef.current
        if (map === null) return
        // The map's maxZoom still holds: setView clamps to it.
        map.setView([latitude, longitude], Math.max(map.getZoom(), CENTER_MIN_ZOOM))
      },
      touchedByUser: () => touchedRef.current,
    }),
    [],
  )

  // Markers by id: add the new ones, remove the gone ones, update the changed ones.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return
    const entries = entriesRef.current
    const wanted = new Set<string>()

    for (const next of markers) {
      wanted.add(next.id)
      const entry = entries.get(next.id)
      if (entry === undefined) {
        const { id } = next
        const marker = L.marker([next.latitude, next.longitude], { icon: markerIcon(next.look), keyboard: true })
        marker.on('click', () => latest.current.onSelect(id))
        const created: MarkerEntry = {
          marker,
          current: next,
          onKeyDown: (event) => {
            // Leaflet 1.9.4 makes the icon focusable (role="button") but does not turn these
            // keys into a click.
            if (event.key === 'Enter' || event.key === ' ') {
              if (event.key === ' ') event.preventDefault()
              latest.current.onSelect(id)
            }
          },
        }
        marker.addTo(map)
        entries.set(id, created)
        decorate(created)
        continue
      }
      const previous = entry.current
      entry.current = next
      if (previous.latitude !== next.latitude || previous.longitude !== next.longitude) {
        entry.marker.setLatLng([next.latitude, next.longitude])
      }
      if (previous.look !== next.look || previous.label !== next.label) {
        entry.marker.setIcon(markerIcon(next.look))
        decorate(entry)
      }
    }

    for (const [id, entry] of entries) {
      if (wanted.has(id)) continue
      entry.marker.remove()
      entries.delete(id)
    }
    // tileApiKey: a new key recreates the map (above), and the new map starts with no marker.
  }, [markers, tileApiKey])

  // The position: created on the first one, moved on the next ones, removed on null.
  useEffect(() => {
    const map = mapRef.current
    if (map === null) return
    const layers = positionRef.current
    if (position === null) {
      layers?.accuracy.remove()
      layers?.dot.remove()
      positionRef.current = null
      return
    }
    const latLng: L.LatLngTuple = [position.latitude, position.longitude]
    if (layers === null) {
      // L.circle, in metres: it grows and shrinks with the zoom (an L.circleMarker is in pixels).
      const accuracy = L.circle(latLng, { ...ACCURACY_STYLE, radius: position.accuracyM }).addTo(map)
      const dot = L.marker(latLng, { icon: POSITION_ICON, interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map)
      // The accessible information is on the centre button.
      dot.getElement()?.setAttribute('aria-hidden', 'true')
      positionRef.current = { accuracy, dot }
      return
    }
    layers.accuracy.setLatLng(latLng)
    layers.accuracy.setRadius(position.accuracyM)
    layers.dot.setLatLng(latLng)
    // tileApiKey: a new key recreates the map (above), and the new map starts with no position.
  }, [position, tileApiKey])

  return <div ref={containerRef} className="leaflet-map" />
}

export default LeafletMap
