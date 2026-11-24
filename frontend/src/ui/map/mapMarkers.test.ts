import { describe, expect, test } from 'vitest'
import type { BaitSiteStatus, ReplayResult } from '../../core/baitSiteStateMachine'
import type { BaitSiteView } from '../../core/localMerge'
import { initialView, mapMarkers, type MapMarker, type MapMarkerLook } from './mapMarkers'

function site(id: string, name: string, replay: ReplayResult, overrides: Partial<BaitSiteView> = {}): BaitSiteView {
  return {
    id,
    name,
    latitude: -27.1,
    longitude: -49.1,
    locationAccuracyM: 5,
    createdAt: '2026-11-01T12:00:00Z',
    pending: false,
    events: [],
    pendingVoidEventIds: [],
    replay,
    rejection: null,
    ...overrides,
  }
}

const valid = (status: BaitSiteStatus): ReplayResult => ({ valid: true, status })
const INVALID: ReplayResult = { valid: false, firstInvalidIndex: 1 }

describe('mapMarkers', () => {
  test.each<[BaitSiteStatus, MapMarkerLook]>([
    ['EMPTY', 'empty'],
    ['ARMED', 'armed'],
    ['ACTIVE', 'active'],
    ['CAPTURED', 'captured'],
    ['LOST', 'lost'],
  ])('%s gives the %s look', (status, look) => {
    const [marker] = mapMarkers([site('s-1', 'Isca 1', valid(status))])

    expect(marker?.look).toBe(look)
  })

  test('an invalid replay gives the invalid look, whatever came before', () => {
    const [marker] = mapMarkers([site('s-1', 'Isca 1', INVALID)])

    expect(marker?.look).toBe('invalid')
  })

  test('the label is the name and the status text', () => {
    const markers = mapMarkers([site('s-3', 'Isca 3', valid('ACTIVE')), site('s-4', 'Isca 3', INVALID)])

    expect(markers.map((marker) => marker.label)).toEqual(['Isca 3, Com atividade', 'Isca 3, Histórico inválido'])
  })

  test("in the view's order, with id and position; a pending site has a marker like any other", () => {
    const markers = mapMarkers([
      site('s-2', 'Zeta', valid('ARMED'), { latitude: -27.2, longitude: -49.2 }),
      site('s-1', 'Alfa', valid('ARMED'), { latitude: -27.3, longitude: -49.3, pending: true, createdAt: null }),
    ])

    expect(markers).toEqual<MapMarker[]>([
      { id: 's-2', latitude: -27.2, longitude: -49.2, look: 'armed', label: 'Zeta, Armada' },
      { id: 's-1', latitude: -27.3, longitude: -49.3, look: 'armed', label: 'Alfa, Armada' },
    ])
  })

  test('no site, no marker', () => {
    expect(mapMarkers([])).toEqual([])
  })
})

describe('initialView', () => {
  const at = (id: string, latitude: number, longitude: number): MapMarker => ({
    id,
    latitude,
    longitude,
    look: 'armed',
    label: id,
  })

  test('no marker: empty', () => {
    expect(initialView([])).toEqual({ kind: 'empty' })
  })

  test('one marker: that point at zoom 16', () => {
    expect(initialView([at('a', -27.1, -49.1)])).toEqual({ kind: 'point', latitude: -27.1, longitude: -49.1, zoom: 16 })
  })

  test('several: the box of the minimum and maximum coordinates', () => {
    expect(initialView([at('a', -27.1, -49.5), at('b', -27.4, -49.0), at('c', -26.9, -49.2)])).toEqual({
      kind: 'bounds',
      south: -27.4,
      west: -49.5,
      north: -26.9,
      east: -49.0,
    })
  })
})
