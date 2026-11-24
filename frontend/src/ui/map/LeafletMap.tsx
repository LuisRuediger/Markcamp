import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { initialView, type MapMarker, type MapMarkerLook, type MapView } from './mapMarkers'

// The only file that imports leaflet (decision R1 of slice F4-1, enforced in .oxlintrc.json).
// Leaflet is used directly, without a React wrapper: this component creates the map once in
// an effect, owns it, and removes it on unmount. React renders the div; Leaflet draws inside
// it. Markers are kept in sync with the `markers` prop by id, so the map is never recreated
// because the data changed.

/** Thunderforest Landscape. {r} is "@2x" on retina screens. Online only until slice F4-4. */
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

const PULSE_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-on-honey)" ' +
  'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h4l2.5-6 5 12 2.5-6h6"/></svg>'
const CHECK_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" ' +
  'stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

// Keyed by every look: a new look does not compile until it has its inner content.
const INNER = {
  empty: '',
  armed: '',
  active: PULSE_ICON,
  captured: CHECK_ICON,
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
  /** After every move or zoom made on the map (not for the starting view). */
  onViewChange: (view: MapView) => void
}

function LeafletMap({ markers, tileApiKey, startView, onSelect, onViewChange }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const entriesRef = useRef(new Map<string, MarkerEntry>())
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
    L.tileLayer(TILE_URL + encodeURIComponent(tileApiKey), { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(map)

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
    // After the starting view, so only the user's moves are reported.
    map.on('moveend', () => {
      const center = map.getCenter()
      latest.current.onViewChange({ latitude: center.lat, longitude: center.lng, zoom: map.getZoom() })
    })

    mapRef.current = map
    const entries = entriesRef.current
    return () => {
      mapRef.current = null
      // The markers belonged to this map: the next one starts with none.
      entries.clear()
      map.remove()
    }
  }, [tileApiKey])

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

  return <div ref={containerRef} className="leaflet-map" />
}

export default LeafletMap
