import { act, fireEvent, render, screen } from '@testing-library/react'
import { useImperativeHandle, useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { trueHeading } from '../core/heading'
import { toHistoryInstant } from '../core/historyOrder'
import { createProjectViewCache } from '../core/localMerge'
import type { LocalBaitSite, LocalEvent, LocalStore } from '../core/localStore'
import type { GeoReading, HeadingPermission } from '../core/ports'
import { createFakeGeolocation } from './fakeGeolocation'
import { createFakeHeading } from './fakeHeading'
import { ptBR } from './i18n/pt-BR'
import { declinationDeg } from './map/declination'
import type { LeafletMapHandle, LeafletMapProps } from './map/LeafletMap'
import type { MapView } from './map/mapMarkers'
import MapScreen from './MapScreen'

// jsdom cannot draw a map, and LeafletMap.test.tsx covers the real one: here it is a double
// that shows one button per marker, records the props it gets and hands a fake handle to the
// ref (slice F4-3). The only module mock of slice F4-1. Its centre is Blumenau (slice F4-5).
const leafletMap = vi.hoisted(() => vi.fn<(props: LeafletMapProps) => void>())
const handle = vi.hoisted(() => ({
  centerOn: vi.fn<LeafletMapHandle['centerOn']>(),
  touchedByUser: vi.fn<LeafletMapHandle['touchedByUser']>(() => false),
  center: vi.fn<LeafletMapHandle['center']>(() => ({ latitude: -26.92, longitude: -49.07 })),
}))

vi.mock('./map/LeafletMap', () => ({
  default: function FakeLeafletMap(props: LeafletMapProps) {
    leafletMap(props)
    useImperativeHandle(props.ref, () => handle, [])
    return (
      <div data-testid="map">
        {props.markers.map((marker) => (
          <button key={marker.id} type="button" onClick={() => props.onSelect(marker.id)}>
            {marker.label}
          </button>
        ))}
      </div>
    )
  },
}))

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

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
  handle.centerOn.mockClear()
  handle.touchedByUser.mockReset()
  handle.touchedByUser.mockReturnValue(false)
  const store = createFakeLocalStore()
  await prepare(store)
  const onOpenSite = vi.fn<(baitSiteId: string) => void>()
  const onViewChange = vi.fn<(view: MapView) => void>()
  const geo = createFakeGeolocation()
  const heading = createFakeHeading()
  const view = createProjectViewCache(store)(P)
  // The compass's on/off belongs to App: here a state, as App's.
  function Harness() {
    const [compassOn, setCompassOn] = useState(false)
    return (
      <MapScreen
        view={view}
        tileApiKey="key"
        savedView={savedView}
        onViewChange={onViewChange}
        onOpenSite={onOpenSite}
        geolocation={geo.port}
        heading={heading.port}
        compassOn={compassOn}
        onCompassChange={setCompassOn}
      />
    )
  }
  const result = render(<Harness />)
  return { onOpenSite, onViewChange, geo, heading, unmount: result.unmount }
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

describe('the position (slice F4-3)', () => {
  const HERE: GeoReading = { latitude: -27.3, longitude: -49.3, accuracyM: 8 }
  const THERE: GeoReading = { latitude: -27.4, longitude: -49.4, accuracyM: 4 }

  /** The map's project with one site, shown. */
  async function shown(savedView: MapView | null = null) {
    const rendered = await setup((store) => project(store, [site('s-1', 'Isca 1')]), savedView)
    await screen.findByText('Apiário da Serra · 1 isca')
    return rendered
  }

  const lastProps = () => leafletMap.mock.calls.at(-1)?.[0]
  const centerButton = () => screen.queryByRole<HTMLButtonElement>('button', { name: /^Centralizar na sua posição/ })
  const blockedWarning = () => screen.queryByText(ptBR.map.locationBlocked)

  test('the map gets the reading as its position, null before', async () => {
    const { geo } = await shown()
    expect(lastProps()?.position).toBeNull()

    act(() => geo.emit(HERE))

    expect(lastProps()?.position).toEqual(HERE)
  })

  test('the map screen watches once, and stops on unmount', async () => {
    const { geo, unmount } = await shown()
    expect(geo.watch).toHaveBeenCalledOnce()
    expect(geo.activeCount()).toBe(1)

    unmount()

    expect(geo.activeCount()).toBe(0)
  })

  describe('the jump to the position', () => {
    test('no saved view: the first reading centres the map on it, once', async () => {
      const { geo } = await shown()
      expect(handle.centerOn).not.toHaveBeenCalled()

      act(() => geo.emit(HERE))
      expect(handle.centerOn).toHaveBeenCalledExactlyOnceWith(HERE.latitude, HERE.longitude)

      act(() => geo.emit(THERE))
      expect(handle.centerOn).toHaveBeenCalledOnce()
    })

    test('a saved view: never', async () => {
      const { geo } = await shown({ latitude: -27.15, longitude: -49.15, zoom: 15 })

      act(() => geo.emit(HERE))
      act(() => geo.emit(THERE))

      expect(handle.centerOn).not.toHaveBeenCalled()
    })

    test('the map touched before the reading: never, not even on a later reading', async () => {
      const { geo } = await shown()
      handle.touchedByUser.mockReturnValue(true)

      act(() => geo.emit(HERE))
      handle.touchedByUser.mockReturnValue(false)
      act(() => geo.emit(THERE))

      expect(handle.centerOn).not.toHaveBeenCalled()
    })

    test('denied: never', async () => {
      const { geo } = await shown()

      act(() => geo.fail('denied'))

      expect(handle.centerOn).not.toHaveBeenCalled()
    })
  })

  describe('the centre button', () => {
    test('searching: disabled, with the searching name', async () => {
      await shown()

      const button = screen.getByRole<HTMLButtonElement>('button', { name: ptBR.map.centerSearching })
      expect(button.disabled).toBe(true)
    })

    test('located: enabled; a tap centres on the last reading', async () => {
      const { geo } = await shown()
      act(() => geo.emit(HERE))
      act(() => geo.emit(THERE))
      handle.centerOn.mockClear()

      const button = screen.getByRole<HTMLButtonElement>('button', { name: ptBR.map.center })
      expect(button.disabled).toBe(false)
      fireEvent.click(button)

      expect(handle.centerOn).toHaveBeenCalledExactlyOnceWith(THERE.latitude, THERE.longitude)
    })

    test('unsupported: no button', async () => {
      const { geo } = await shown()

      act(() => geo.fail('unsupported'))

      expect(centerButton()).toBeNull()
    })
  })

  describe('the blocked warning', () => {
    async function denied() {
      const rendered = await shown()
      act(() => rendered.geo.fail('denied'))
      return rendered
    }

    const tapCenter = () => fireEvent.click(screen.getByRole('button', { name: ptBR.map.center }))

    test('denied: the button is enabled, and the warning shows only after a tap', async () => {
      await denied()
      expect(blockedWarning()).toBeNull()
      expect(screen.queryByRole('status')).toBeNull()

      const button = screen.getByRole<HTMLButtonElement>('button', { name: ptBR.map.center })
      expect(button.disabled).toBe(false)
      fireEvent.click(button)

      expect(screen.getByRole('status').textContent).toBe(ptBR.map.locationBlocked)
      expect(handle.centerOn).not.toHaveBeenCalled()
    })

    test('hides after 6 s; each tap shows it again from 0', async () => {
      await denied()
      vi.useFakeTimers()

      tapCenter()
      act(() => vi.advanceTimersByTime(5000))
      expect(blockedWarning()).not.toBeNull()

      // A second tap restarts the 6 s.
      tapCenter()
      act(() => vi.advanceTimersByTime(5000))
      expect(blockedWarning()).not.toBeNull()
      act(() => vi.advanceTimersByTime(1000))
      expect(blockedWarning()).toBeNull()

      tapCenter()
      expect(blockedWarning()).not.toBeNull()
    })

    test('hides on a press on the map; a press on the button does not hide it', async () => {
      await denied()
      tapCenter()

      fireEvent.pointerDown(screen.getByRole('button', { name: ptBR.map.center }))
      expect(blockedWarning()).not.toBeNull()

      fireEvent.pointerDown(screen.getByTestId('map'))
      expect(blockedWarning()).toBeNull()

      tapCenter()
      expect(blockedWarning()).not.toBeNull()
    })

    test('never by itself: not on denied, not after a while', async () => {
      await denied()
      vi.useFakeTimers()

      act(() => vi.advanceTimersByTime(10_000))

      expect(blockedWarning()).toBeNull()
    })
  })
})

describe('the compass (slice F4-5)', () => {
  /** The map's project with one site, shown, then fake timers (they fake animation frames too). */
  async function shown() {
    const rendered = await setup((store) => project(store, [site('s-1', 'Isca 1')]))
    await screen.findByText('Apiário da Serra · 1 isca')
    vi.useFakeTimers()
    return rendered
  }

  const compassButton = () => screen.getByRole('button', { name: ptBR.map.compass })
  const lastProps = () => leafletMap.mock.calls.at(-1)?.[0]
  const notice = () => screen.queryByRole('status')
  const rose = () => {
    const group = compassButton().querySelector('svg > g')
    if (group === null) throw new Error('no rose')
    return group
  }

  async function tapAndAnswer(rendered: Awaited<ReturnType<typeof shown>>, permission: HeadingPermission) {
    fireEvent.click(compassButton())
    await act(async () => {
      rendered.heading.answer(permission)
    })
  }

  /** On, and one heading delivered. */
  async function delivering(magneticDeg = 244) {
    const rendered = await shown()
    await tapAndAnswer(rendered, 'granted')
    act(() => {
      rendered.heading.emit(magneticDeg)
      vi.advanceTimersToNextFrame()
    })
    return rendered
  }

  /** A matchMedia whose "(orientation: landscape)" the test turns. */
  function stubOrientation() {
    let landscape = false
    const listeners = new Set<() => void>()
    vi.stubGlobal('matchMedia', () => ({
      get matches() {
        return landscape
      },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }))
    return (next: 'landscape' | 'portrait') => {
      landscape = next === 'landscape'
      act(() => {
        for (const listener of [...listeners]) listener()
      })
    }
  }

  test('a button named "Bússola", not pressed; the rose N up', async () => {
    await shown()

    expect(compassButton().getAttribute('aria-pressed')).toBe('false')
    expect(rose().getAttribute('transform')).toBe('rotate(0 18 18)')
  })

  test('a tap calls enable(); granted: pressed, listening', async () => {
    const rendered = await shown()

    fireEvent.click(compassButton())
    expect(rendered.heading.enable).toHaveBeenCalledOnce()
    await act(async () => {
      rendered.heading.answer('granted')
    })

    expect(compassButton().getAttribute('aria-pressed')).toBe('true')
    expect(rendered.heading.activeCount()).toBe(1)
  })

  test.each([
    ['denied', ptBR.map.compassDenied],
    ['unsupported', ptBR.map.compassMissing],
  ] as const)('%s: the notice, and the button stays off', async (permission, text) => {
    const rendered = await shown()

    await tapAndAnswer(rendered, permission)

    expect(notice()?.textContent).toBe(text)
    expect(compassButton().getAttribute('aria-pressed')).toBe('false')
  })

  test('no heading for 3 s: "Este aparelho não tem bússola." and off again', async () => {
    const rendered = await shown()
    await tapAndAnswer(rendered, 'granted')

    act(() => vi.advanceTimersByTime(3000))

    expect(notice()?.textContent).toBe(ptBR.map.compassMissing)
    expect(compassButton().getAttribute('aria-pressed')).toBe('false')
    expect(rendered.heading.activeCount()).toBe(0)
  })

  test('a compass notice hides after 6 s', async () => {
    const rendered = await shown()
    await tapAndAnswer(rendered, 'denied')

    act(() => vi.advanceTimersByTime(5999))
    expect(notice()).not.toBeNull()
    act(() => vi.advanceTimersByTime(1))

    expect(notice()).toBeNull()
  })

  test('a compass notice hides on a press on the map, not on a press on the compass button', async () => {
    const rendered = await shown()
    await tapAndAnswer(rendered, 'denied')

    fireEvent.pointerDown(compassButton())
    expect(notice()?.textContent).toBe(ptBR.map.compassDenied)
    // On the rose inside the button too.
    fireEvent.pointerDown(rose())
    expect(notice()).not.toBeNull()

    fireEvent.pointerDown(screen.getByTestId('map'))
    expect(notice()).toBeNull()
  })

  test('a new notice replaces the shown one, from 0', async () => {
    const rendered = await shown()
    await tapAndAnswer(rendered, 'denied')
    act(() => vi.advanceTimersByTime(5000))

    await tapAndAnswer(rendered, 'unsupported')
    act(() => vi.advanceTimersByTime(5000))

    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(notice()?.textContent).toBe(ptBR.map.compassMissing)
  })

  test('landscape while on: "Gire o celular…", the rose faded; back to portrait the notice goes at once', async () => {
    const turn = stubOrientation()
    const rendered = await delivering()

    turn('landscape')

    expect(notice()?.textContent).toBe(ptBR.map.compassLandscape)
    expect(compassButton().classList.contains('map-compass--landscape')).toBe(true)
    expect(compassButton().getAttribute('aria-pressed')).toBe('true')
    expect(lastProps()?.heading).toBeNull()
    expect(rendered.heading.activeCount()).toBe(0)

    turn('portrait')

    expect(notice()).toBeNull()
    expect(compassButton().classList.contains('map-compass--landscape')).toBe(false)
    expect(rendered.heading.activeCount()).toBe(1)
  })

  test('the map gets heading null when off, a source when on and delivering', async () => {
    const rendered = await shown()
    expect(lastProps()?.heading).toBeNull()

    await tapAndAnswer(rendered, 'granted')
    expect(lastProps()?.heading).toBeNull()

    act(() => {
      rendered.heading.emit(244)
      vi.advanceTimersToNextFrame()
    })
    const source = lastProps()?.heading
    expect(source?.current()).toBeCloseTo(trueHeading(244, declinationDeg(-26.92, -49.07, new Date())), 9)

    fireEvent.click(compassButton())
    expect(lastProps()?.heading).toBeNull()
  })

  test('244 magnetic at Blumenau: the rose turns by minus the true heading; off: N up again', async () => {
    await delivering(244)
    const expected = trueHeading(244, declinationDeg(-26.92, -49.07, new Date()))

    const match = /^rotate\((-?[\d.]+) 18 18\)$/.exec(rose().getAttribute('transform') ?? '')
    expect(match).not.toBeNull()
    expect(Number(match?.[1])).toBeCloseTo(-expected, 2)

    fireEvent.click(compassButton())
    expect(rose().getAttribute('transform')).toBe('rotate(0 18 18)')
  })
})
