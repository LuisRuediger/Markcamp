import { fireEvent, render, screen } from '@testing-library/react'
import { createRef, StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GeoReading } from '../../core/ports'
import LeafletMap, { type LeafletMapHandle, type LeafletMapProps } from './LeafletMap'
import type { MapMarker } from './mapMarkers'

// The real Leaflet 1.9.4 in jsdom. jsdom has no layout, so every element measures 0 × 0 and
// Leaflet would load no tile; the container's size is stubbed to 400 × 400 (jsdom does not
// fetch the images either). Rendered under StrictMode, like the app: the effect runs twice.

const KEY = 'test-key-123'

function marker(id: string, look: MapMarker['look'], latitude = -27.1, longitude = -49.1): MapMarker {
  return { id, latitude, longitude, look, label: `Isca ${id}, ${look}` }
}

const A = marker('1', 'armed', -27.1, -49.1)
const B = marker('2', 'active', -27.2, -49.2)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function setup(
  markers: readonly MapMarker[] = [A, B],
  startView: LeafletMapProps['startView'] = null,
  position: GeoReading | null = null,
) {
  const onSelect = vi.fn<(id: string) => void>()
  const onViewChange = vi.fn<LeafletMapProps['onViewChange']>()
  const ref = createRef<LeafletMapHandle>()
  const element = (next: readonly MapMarker[], nextPosition: GeoReading | null) => (
    <StrictMode>
      <LeafletMap
        ref={ref}
        markers={next}
        tileApiKey={KEY}
        startView={startView}
        onSelect={onSelect}
        onViewChange={onViewChange}
        position={nextPosition}
      />
    </StrictMode>
  )
  const result = render(element(markers, position))
  function handle(): LeafletMapHandle {
    if (ref.current === null) throw new Error('no handle')
    return ref.current
  }
  return {
    ...result,
    onSelect,
    onViewChange,
    handle,
    rerenderWith: (next: readonly MapMarker[]) => result.rerender(element(next, position)),
    rerenderPosition: (next: GeoReading | null) => result.rerender(element(markers, next)),
  }
}

function markerButton(label: string): HTMLElement {
  return screen.getByRole('button', { name: label })
}

function mapPanes(): Element[] {
  return [...document.querySelectorAll('.leaflet-map-pane')]
}

test('one focusable element per marker, role="button", named by its label', () => {
  setup()

  const buttons = screen.getAllByRole('button')
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Isca 1, armed', 'Isca 2, active'])
  for (const button of buttons) {
    expect(button.tabIndex).toBe(0)
    expect(button.classList.contains('map-marker')).toBe(true)
  }
  expect(markerButton('Isca 2, active').classList.contains('map-marker--active')).toBe(true)
})

describe('selecting a marker', () => {
  test('click calls onSelect with its id', () => {
    const { onSelect } = setup()

    fireEvent.click(markerButton('Isca 2, active'))

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('2')
  })

  test.each(['Enter', ' '])('the %j key calls onSelect with its id', (key) => {
    const { onSelect } = setup()

    const notCancelled = fireEvent.keyDown(markerButton('Isca 1, armed'), { key })

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('1')
    // Space would scroll the page.
    if (key === ' ') expect(notCancelled).toBe(false)
  })

  test('another key does nothing', () => {
    const { onSelect } = setup()

    fireEvent.keyDown(markerButton('Isca 1, armed'), { key: 'a' })

    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('changing the markers', () => {
  test('adds, removes and restyles on the same map, without moving the view', () => {
    const { rerenderWith, onViewChange, onSelect } = setup()
    const [pane] = mapPanes()

    const changedB = { ...B, look: 'captured', label: 'Isca 2, captured' } satisfies MapMarker
    const C = marker('3', 'lost', -26.5, -48.5)
    rerenderWith([changedB, C])

    expect(screen.queryByRole('button', { name: 'Isca 1, armed' })).toBeNull()
    const restyled = markerButton('Isca 2, captured')
    expect(restyled.classList.contains('map-marker--captured')).toBe(true)
    expect(restyled.classList.contains('map-marker--active')).toBe(false)
    expect(markerButton('Isca 3, lost')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(2)

    // The same map: its pane is still the one created at mount, and the only one.
    expect(mapPanes()).toEqual([pane])
    expect(pane?.isConnected).toBe(true)
    // Nothing recentred or refitted it.
    expect(onViewChange).not.toHaveBeenCalled()

    // The restyled marker still answers, once, to keyboard and click.
    fireEvent.keyDown(restyled, { key: 'Enter' })
    fireEvent.click(restyled)
    expect(onSelect.mock.calls).toEqual([['2'], ['2']])
  })

  test('a moved marker keeps its element and gets the new position', () => {
    const { rerenderWith } = setup()
    const before = markerButton('Isca 1, armed')
    // jsdom has no 3D transforms, so Leaflet places icons with left and top.
    const position = () => [before.style.left, before.style.top, before.style.transform].join()
    const old = position()

    rerenderWith([{ ...A, latitude: -27.0, longitude: -49.0 }, B])

    expect(markerButton('Isca 1, armed')).toBe(before)
    expect(position()).not.toBe(old)
  })
})

test('a move made on the map is reported with its centre and zoom', () => {
  const { onViewChange, container } = setup([A], null)
  const element = container.querySelector('.leaflet-map')
  if (element === null) throw new Error('no map')

  // Leaflet's own keyboard handler, active while the map has focus: "+" zooms in (no
  // animation in jsdom), which ends with moveend.
  fireEvent.focus(element)
  fireEvent.keyDown(document, { keyCode: 187, key: '+' })

  expect(onViewChange).toHaveBeenCalled()
  const view = onViewChange.mock.calls.at(-1)?.[0]
  expect(view?.zoom).toBe(17)
  expect(view?.latitude).toBeCloseTo(A.latitude, 6)
  expect(view?.longitude).toBeCloseTo(A.longitude, 6)
})

test('tiles come from Thunderforest Landscape, with the key', () => {
  setup()

  const tiles = [...document.querySelectorAll<HTMLImageElement>('img.leaflet-tile')]
  expect(tiles.length).toBeGreaterThan(0)
  for (const tile of tiles) {
    const url = new URL(tile.src)
    expect(url.origin).toBe('https://api.thunderforest.com')
    expect(url.pathname.startsWith('/landscape/')).toBe(true)
    expect(url.searchParams.get('apikey')).toBe(KEY)
  }
})

test('attribution: Thunderforest and OpenStreetMap, no "Leaflet"; no zoom buttons', () => {
  setup()

  const attribution = document.querySelector('.leaflet-control-attribution')
  expect(attribution?.textContent).toContain('© Thunderforest')
  expect(attribution?.textContent).toContain('© OpenStreetMap')
  expect(attribution?.textContent).not.toContain('Leaflet')
  expect(document.querySelector('.leaflet-control-zoom')).toBeNull()
})

test('unmount removes the map: the container is left empty', () => {
  const { container, unmount } = setup()
  const element = container.querySelector('.leaflet-map')
  if (element === null) throw new Error('no map')
  expect(element.childElementCount).toBeGreaterThan(0)

  unmount()

  expect(element.childElementCount).toBe(0)
  expect(document.querySelector('.leaflet-container')).toBeNull()
})

describe('the position (slice F4-3)', () => {
  const HERE: GeoReading = { latitude: -27.1, longitude: -49.1, accuracyM: 50 }

  const accuracyPaths = () => [...document.querySelectorAll('.leaflet-overlay-pane path')]
  const dots = () => [...document.querySelectorAll<HTMLElement>('.map-position')]

  function onlyDot(): HTMLElement {
    const [dot, ...rest] = dots()
    if (dot === undefined || rest.length > 0) throw new Error('not exactly one dot')
    return dot
  }

  function onlyPath(): Element {
    const [path, ...rest] = accuracyPaths()
    if (path === undefined || rest.length > 0) throw new Error('not exactly one path')
    return path
  }

  /** The circle's radius in pixels, from its SVG path: "M… a r,r 0 1,0 …". */
  function pathRadius(): number {
    const match = /a(\d+(?:\.\d+)?),/.exec(onlyPath().getAttribute('d') ?? '')
    if (match === null) throw new Error('not a circle path')
    return Number(match[1])
  }

  test('null: no circle and no dot', () => {
    setup([A, B], null, null)

    expect(accuracyPaths()).toHaveLength(0)
    expect(dots()).toHaveLength(0)
  })

  test('a position: one circle path and one dot, which takes no focus and no touch', () => {
    setup([A, B], null, HERE)

    expect(accuracyPaths()).toHaveLength(1)
    const dot = onlyDot()
    expect(dot.hasAttribute('tabindex')).toBe(false)
    expect(dot.hasAttribute('role')).toBe(false)
    expect(dot.classList.contains('leaflet-interactive')).toBe(false)
    expect(dot.getAttribute('aria-hidden')).toBe('true')
    // The circle takes no touch either.
    expect(onlyPath().classList.contains('leaflet-interactive')).toBe(false)
    // The site markers are still the only buttons.
    expect(screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Isca 1, armed',
      'Isca 2, active',
    ])
  })

  test('the circle is in metres: its radius on screen doubles with one zoom in', () => {
    const { container } = setup([A], null, HERE)
    const before = pathRadius()
    const element = container.querySelector('.leaflet-map')
    if (element === null) throw new Error('no map')

    fireEvent.focus(element)
    fireEvent.keyDown(document, { keyCode: 187, key: '+' })

    expect(pathRadius()).toBeCloseTo(before * 2, -1)
  })

  test('a new position moves both on the same map; null removes both', () => {
    const { rerenderPosition } = setup([A, B], null, HERE)
    const [pane] = mapPanes()
    const dot = onlyDot()
    const path = onlyPath()
    const dotPlace = () => [dot.style.left, dot.style.top, dot.style.transform].join()
    const oldDot = dotPlace()
    const oldPath = path.getAttribute('d')

    rerenderPosition({ latitude: -27.15, longitude: -49.15, accuracyM: 50 })

    expect(onlyDot()).toBe(dot)
    expect(onlyPath()).toBe(path)
    expect(dotPlace()).not.toBe(oldDot)
    expect(path.getAttribute('d')).not.toBe(oldPath)
    expect(mapPanes()).toEqual([pane])

    // A new accuracy only: a bigger circle, same place.
    const movedPath = path.getAttribute('d')
    rerenderPosition({ latitude: -27.15, longitude: -49.15, accuracyM: 200 })
    expect(path.getAttribute('d')).not.toBe(movedPath)

    rerenderPosition(null)
    expect(dots()).toHaveLength(0)
    expect(accuracyPaths()).toHaveLength(0)
    expect(mapPanes()).toEqual([pane])
  })

  test('the position never moves the map', () => {
    const { rerenderPosition, onViewChange } = setup([A, B], null, HERE)

    rerenderPosition({ latitude: -20, longitude: -40, accuracyM: 10 })

    expect(onViewChange).not.toHaveBeenCalled()
  })
})

describe('the handle (slice F4-3)', () => {
  const FAR = { latitude: -20.5, longitude: -40.5 }

  test.each([
    [15, 17],
    [17, 17],
    [18, 18],
  ])('centerOn from zoom %i lands at %i on the point, reported by onViewChange', (from, to) => {
    const { handle, onViewChange } = setup([A, B], { latitude: -27.1, longitude: -49.1, zoom: from })
    expect(onViewChange).not.toHaveBeenCalled()

    handle().centerOn(FAR.latitude, FAR.longitude)

    const view = onViewChange.mock.calls.at(-1)?.[0]
    expect(view?.zoom).toBe(to)
    expect(view?.latitude).toBeCloseTo(FAR.latitude, 6)
    expect(view?.longitude).toBeCloseTo(FAR.longitude, 6)
  })

  test('touchedByUser: false at the start, true after a press on the map', () => {
    const { handle, container } = setup()
    const element = container.querySelector('.leaflet-map')
    if (element === null) throw new Error('no map')
    expect(handle().touchedByUser()).toBe(false)

    fireEvent.pointerDown(element)

    expect(handle().touchedByUser()).toBe(true)
  })

  test.each(['wheel', 'keydown'] as const)('touchedByUser: true after a %s on the map', (type) => {
    const { handle, container } = setup()
    const element = container.querySelector('.leaflet-map')
    if (element === null) throw new Error('no map')

    element.dispatchEvent(new Event(type, { bubbles: true }))

    expect(handle().touchedByUser()).toBe(true)
  })

  test('centerOn does not count as a touch', () => {
    const { handle } = setup()

    handle().centerOn(FAR.latitude, FAR.longitude)

    expect(handle().touchedByUser()).toBe(false)
  })
})

test('a Captured marker has the bee and no check mark (slice F4-3)', () => {
  setup([marker('1', 'captured')])

  const dot = markerButton('Isca 1, captured').querySelector('.map-marker__dot')
  expect(dot?.querySelectorAll('ellipse')).toHaveLength(3)
  expect(dot?.innerHTML).not.toContain('M5 12.5l4.5 4.5L19 7.5')
  expect(dot?.textContent).not.toContain('✓')
})
