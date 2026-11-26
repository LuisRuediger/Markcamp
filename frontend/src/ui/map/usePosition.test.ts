import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { GeoReading } from '../../core/ports'
import { createFakeGeolocation } from '../fakeGeolocation'
import { usePosition } from './usePosition'

const A: GeoReading = { latitude: -27.1, longitude: -49.1, accuracyM: 5 }
const B: GeoReading = { latitude: -27.2, longitude: -49.2, accuracyM: 30 }

let visibility: DocumentVisibilityState = 'visible'

afterEach(() => {
  visibility = 'visible'
  vi.restoreAllMocks()
})

/** document.visibilityState is read-only in jsdom: a getter the test controls. */
function stubVisibility() {
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
}

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

function setup() {
  stubVisibility()
  const geo = createFakeGeolocation()
  const hook = renderHook(() => usePosition(geo.port))
  return { geo, ...hook }
}

test("starts 'searching' and watches once", () => {
  const { geo, result } = setup()

  expect(result.current).toEqual({ status: 'searching' })
  expect(geo.watch).toHaveBeenCalledOnce()
  expect(geo.activeCount()).toBe(1)
})

test('hidden at mount: no watch until visible', () => {
  visibility = 'hidden'
  const { geo, result } = setup()

  expect(geo.watch).not.toHaveBeenCalled()
  expect(result.current).toEqual({ status: 'searching' })

  setVisibility('visible')
  expect(geo.activeCount()).toBe(1)
})

describe('readings', () => {
  test("a usable reading: 'located' with it", () => {
    const { geo, result } = setup()

    act(() => geo.emit(A))

    expect(result.current).toEqual({ status: 'located', reading: A })
  })

  test('a second usable reading replaces it, even when less accurate', () => {
    const { geo, result } = setup()

    act(() => geo.emit(A))
    act(() => geo.emit(B))

    expect(result.current).toEqual({ status: 'located', reading: B })
  })

  test('an unusable reading is ignored', () => {
    const { geo, result } = setup()

    act(() => geo.emit({ latitude: Number.NaN, longitude: -49.1, accuracyM: 5 }))
    expect(result.current).toEqual({ status: 'searching' })

    act(() => geo.emit(A))
    act(() => geo.emit({ latitude: -27.3, longitude: -49.3, accuracyM: 0 }))
    expect(result.current).toEqual({ status: 'located', reading: A })
  })
})

describe('failures', () => {
  test("'unavailable' keeps the current state, and the watch goes on", () => {
    const { geo, result } = setup()

    act(() => geo.fail('unavailable'))
    expect(result.current).toEqual({ status: 'searching' })

    act(() => geo.emit(A))
    act(() => geo.fail('unavailable'))
    expect(result.current).toEqual({ status: 'located', reading: A })
    expect(geo.activeCount()).toBe(1)
  })

  test("'denied' → 'denied', even with a position shown", () => {
    const { geo, result } = setup()
    act(() => geo.emit(A))

    act(() => geo.fail('denied'))

    expect(result.current).toEqual({ status: 'denied' })
  })

  test("'unsupported' → 'unsupported', and visible again does not watch", () => {
    const { geo, result } = setup()

    act(() => geo.fail('unsupported'))
    expect(result.current).toEqual({ status: 'unsupported' })

    setVisibility('hidden')
    setVisibility('visible')
    expect(geo.watch).toHaveBeenCalledOnce()
    expect(geo.activeCount()).toBe(0)
    expect(result.current).toEqual({ status: 'unsupported' })
  })
})

describe('page visibility', () => {
  test("hidden: the watch stops and the position is forgotten ('searching')", () => {
    const { geo, result } = setup()
    act(() => geo.emit(A))

    setVisibility('hidden')

    expect(geo.activeCount()).toBe(0)
    expect(result.current).toEqual({ status: 'searching' })
  })

  test('visible again: watches again', () => {
    const { geo, result } = setup()
    setVisibility('hidden')

    setVisibility('visible')

    expect(geo.watch).toHaveBeenCalledTimes(2)
    expect(geo.activeCount()).toBe(1)
    act(() => geo.emit(B))
    expect(result.current).toEqual({ status: 'located', reading: B })
  })

  test("visible again after 'denied': watches again, 'searching'", () => {
    const { geo, result } = setup()
    act(() => geo.fail('denied'))

    setVisibility('hidden')
    setVisibility('visible')

    expect(geo.watch).toHaveBeenCalledTimes(2)
    expect(geo.activeCount()).toBe(1)
    expect(result.current).toEqual({ status: 'searching' })
  })
})

describe('unmount', () => {
  test('stops the watch and stops listening to visibility', () => {
    const { geo, unmount } = setup()

    unmount()
    expect(geo.activeCount()).toBe(0)

    setVisibility('hidden')
    setVisibility('visible')
    expect(geo.watch).toHaveBeenCalledOnce()
  })

  test('no update after unmount, even from a callback that arrives late', () => {
    const { geo, result, unmount } = setup()
    const call = geo.watch.mock.calls[0]
    if (call === undefined) throw new Error('no watch')
    const [onReading, onFailure] = call
    const errors = vi.spyOn(console, 'error')

    unmount()
    // Straight to the callbacks: the fake already drops anything sent to a stopped watch.
    act(() => {
      onReading(A)
      onFailure('denied')
    })

    expect(result.current).toEqual({ status: 'searching' })
    expect(errors).not.toHaveBeenCalled()
  })
})
