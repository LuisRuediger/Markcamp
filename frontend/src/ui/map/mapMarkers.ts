import type { BaitSiteStatus } from '../../core/baitSiteStateMachine'
import type { BaitSiteView } from '../../core/localMerge'
import { ptBR } from '../i18n/pt-BR'

// What the map shows, apart from how Leaflet draws it (decision R2 of slice F4-1). Pure
// functions: no Leaflet, no React. LeafletMap receives only MapMarkers, never a BaitSiteView.

export type MapMarkerLook = 'empty' | 'armed' | 'active' | 'captured' | 'lost' | 'invalid'

// Keyed by every status: a new status does not compile until it has a look on the map.
const LOOK = {
  EMPTY: 'empty',
  ARMED: 'armed',
  ACTIVE: 'active',
  CAPTURED: 'captured',
  LOST: 'lost',
} satisfies Record<BaitSiteStatus, MapMarkerLook>

export interface MapMarker {
  readonly id: string
  readonly latitude: number
  readonly longitude: number
  readonly look: MapMarkerLook
  /** The marker's accessible name: "Isca 3, Com atividade". */
  readonly label: string
}

/** Centre and zoom of the map, as the user left it. */
export interface MapView {
  readonly latitude: number
  readonly longitude: number
  readonly zoom: number
}

export type InitialView =
  | { readonly kind: 'empty' }
  | { readonly kind: 'point'; readonly latitude: number; readonly longitude: number; readonly zoom: number }
  | { readonly kind: 'bounds'; readonly south: number; readonly west: number; readonly north: number; readonly east: number }

/** Zoom for a project with a single site: close enough to see the ground around it. */
export const SINGLE_SITE_ZOOM = 16

/** One marker per site, in the view's order (never sorted). A pending site gets one like any other. */
export function mapMarkers(sites: readonly BaitSiteView[]): readonly MapMarker[] {
  return sites.map((site) => {
    const { replay } = site
    const look = replay.valid ? LOOK[replay.status] : 'invalid'
    const status = replay.valid ? ptBR.sites.status[replay.status] : ptBR.sites.invalidHistory
    return { id: site.id, latitude: site.latitude, longitude: site.longitude, look, label: `${site.name}, ${status}` }
  })
}

/** Every site in view: nothing, one point at a fixed zoom, or the box around them all. */
export function initialView(markers: readonly MapMarker[]): InitialView {
  const [first, ...rest] = markers
  if (first === undefined) return { kind: 'empty' }
  if (rest.length === 0) return { kind: 'point', latitude: first.latitude, longitude: first.longitude, zoom: SINGLE_SITE_ZOOM }
  let south = first.latitude
  let north = first.latitude
  let west = first.longitude
  let east = first.longitude
  for (const marker of rest) {
    south = Math.min(south, marker.latitude)
    north = Math.max(north, marker.latitude)
    west = Math.min(west, marker.longitude)
    east = Math.max(east, marker.longitude)
  }
  return { kind: 'bounds', south, west, north, east }
}
