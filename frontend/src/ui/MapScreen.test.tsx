import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant } from '../core/historyOrder'
import { createProjectViewCache } from '../core/localMerge'
import type { LocalBaitSite, LocalEvent, LocalStore } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'
import type { LeafletMapProps } from './map/LeafletMap'
import type { MapView } from './map/mapMarkers'
import MapScreen from './MapScreen'

// jsdom cannot draw a map, and LeafletMap.test.tsx covers the real one: here it is a double
// that shows one button per marker and records the props it gets. The only module mock of
// slice F4-1.
const leafletMap = vi.hoisted(() => vi.fn<(props: LeafletMapProps) => void>())

vi.mock('./map/LeafletMap', () => ({
  default: (props: LeafletMapProps) => {
    leafletMap(props)
    return (
      <div>
        {props.markers.map((marker) => (
          <button key={marker.id} type="button" onClick={() => props.onSelect(marker.id)}>
            {marker.label}
          </button>
        ))}
      </div>
    )
  },
}))

const P = 'p-1'

function site(id: string, name: string): LocalBaitSite {
  return { id, projectId: P, name, latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' }
}

function installed(baitSiteId: string): LocalEvent {
  const occurredAt = toHistoryInstant('2026-11-03T10:00:00Z')
  if (occurredAt === null) throw new Error('not an instant')
  return {
    id: `${baitSiteId}-installed`,
    projectId: P,
    baitSiteId,
    type: 'INSTALLED',
    occurredAt,
    speciesId: null,
    identifiedEventId: null,
    recordedAt: '2026-11-03T12:00:00Z',
  }
}

async function project(store: LocalStore, sites: LocalBaitSite[]) {
  await store.replaceProjects([{ id: P, name: 'Apiário da Serra', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
  await store.replaceProjectSnapshot(P, { baitSites: sites, events: sites.map((s) => installed(s.id)), species: [] })
}

async function setup(prepare: (store: LocalStore) => Promise<void> = async () => {}, savedView: MapView | null = null) {
  leafletMap.mockClear()
  const store = createFakeLocalStore()
  await prepare(store)
  const onOpenSite = vi.fn<(baitSiteId: string) => void>()
  const onViewChange = vi.fn<(view: MapView) => void>()
  render(
    <MapScreen
      view={createProjectViewCache(store)(P)}
      tileApiKey="key"
      savedView={savedView}
      onViewChange={onViewChange}
      onOpenSite={onOpenSite}
    />,
  )
  return { onOpenSite, onViewChange }
}

test('loading first, then the header: MarkCamp, the project name and its number of sites', async () => {
  await setup((store) => project(store, [site('s-1', 'Isca 1'), site('s-2', 'Isca 2')]))

  expect(screen.getByText(ptBR.sites.loading)).toBeTruthy()
  expect(await screen.findByText('Apiário da Serra · 2 iscas')).toBeTruthy()
  expect(screen.getByRole('heading', { name: 'MarkCamp' })).toBeTruthy()
  expect(screen.queryByText(ptBR.map.empty)).toBeNull()
})

test('one site: "1 isca"', async () => {
  await setup((store) => project(store, [site('s-1', 'Isca 1')]))

  expect(await screen.findByText('Apiário da Serra · 1 isca')).toBeTruthy()
})

test('an empty project: the map with the empty text over it', async () => {
  await setup((store) => project(store, []))

  expect(await screen.findByText(ptBR.map.empty)).toBeTruthy()
  expect(screen.getByText('Apiário da Serra · 0 iscas')).toBeTruthy()
  expect(leafletMap).toHaveBeenCalled()
  expect(leafletMap.mock.calls.at(-1)?.[0].markers).toEqual([])
})

test('the map gets the markers, the key and the saved view; selecting a marker opens its site', async () => {
  const saved: MapView = { latitude: -27.15, longitude: -49.15, zoom: 15 }
  const { onOpenSite, onViewChange } = await setup((store) => project(store, [site('s-1', 'Isca 1'), site('s-2', 'Isca 2')]), saved)

  fireEvent.click(await screen.findByRole('button', { name: 'Isca 2, Armada' }))
  expect(onOpenSite).toHaveBeenCalledExactlyOnceWith('s-2')

  const props = leafletMap.mock.calls.at(-1)?.[0]
  expect(props?.markers.map((marker) => marker.id)).toEqual(['s-1', 's-2'])
  expect(props?.tileApiKey).toBe('key')
  expect(props?.startView).toBe(saved)
  // The screen hands the map's report straight up.
  props?.onViewChange(saved)
  expect(onViewChange).toHaveBeenCalledExactlyOnceWith(saved)
})

test('no saved view: the map gets null and fits the sites itself', async () => {
  await setup((store) => project(store, [site('s-1', 'Isca 1')]))
  await screen.findByText('Apiário da Serra · 1 isca')

  expect(leafletMap.mock.calls.at(-1)?.[0].startView).toBeNull()
})

test('a project that is gone: "Projeto não encontrado" and no map', async () => {
  await setup()

  expect(await screen.findByRole('heading', { name: ptBR.sites.projectNotFound })).toBeTruthy()
  expect(leafletMap).not.toHaveBeenCalled()
})
