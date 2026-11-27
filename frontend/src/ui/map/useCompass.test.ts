import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { HeadingPermission } from '../../core/ports'
import { createFakeHeading } from '../fakeHeading'
import { useCompass, type CompassNotice } from './useCompass'

// Fake timers fake requestAnimationFrame too (jsdom has it): advanceTimersToNextFrame runs the
// next frame. The declination is fixed at -16°, so a magnetic 244° is a true 228°.

const DECLINATION = -16
const BLUMENAU = { latitude: -26.92, longitude: -49.07 }

let visibility: DocumentVisibilityState = 'visible'

beforeEach(() => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
})

afterEach(() => {
  visibility = 'visible'
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setVisibility(next: DocumentVisibilityState) {
  visibility = next
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
}

/** A matchMedia whose "(orientation: landscape)" the test turns with turn(). */
function stubOrientation(startLandscape: boolean) {
  let landscape = startLandscape
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return landscape
    },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }
  const matchMedia = vi.fn((_media: string) => query)
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    matchMedia,
    turn(next: 'landscape' | 'portrait') {
      landscape = next === 'landscape'
      act(() => {
        for (const listener of [...listeners]) listener()
      })
    },
  }
}

function setup(initialOn = false) {
  const fake = createFakeHeading()
  const onChange = vi.fn<(on: boolean) => void>()
  const onNotice = vi.fn<(notice: CompassNotice) => void>()
  const declinationAt = vi.fn<(latitude: number, longitude: number) => number>(() => DECLINATION)
  let middle: { latitude: number; longitude: number } | null = BLUMENAU
  const center = vi.fn(() => middle)
  const hook = renderHook(() => {
    // on/off lives in App; here a state the hook's onChange drives, as App's does.
    const [on, setOn] = useState(initialOn)
    const compass = useCompass({
      heading: fake.port,
      on,
      onChange: (next) => {
        onChange(next)
        setOn(next)
      },
      onNotice,
      declinationAt,
      center,
    })
    return { ...compass, on }
  })
  /** Every true heading the current source delivers to a subscriber, from now on. */
  function deliveries(): number[] {
    const got: number[] = []
    const source = hook.result.current.source
    if (source === null) throw new Error('no source')
    source.subscribe((deg) => got.push(deg))
    return got
  }
  return {
    fake,
    onChange,
    onNotice,
    declinationAt,
    center,
    moveCenter(next: { latitude: number; longitude: number } | null) {
      middle = next
    },
    deliveries,
    ...hook,
  }
}

async function answer(fake: ReturnType<typeof createFakeHeading>, permission: HeadingPermission) {
  await act(async () => {
    fake.answer(permission)
  })
}

/** Emits and runs the frame: the first delivery publishes the source. */
function emitAndFrame(fake: ReturnType<typeof createFakeHeading>, magneticDeg: number) {
  act(() => {
    fake.emit(magneticDeg)
    vi.advanceTimersToNextFrame()
  })
}

/** On and listening, with one heading (244 magnetic, 228 true) already delivered. */
function delivering() {
  const rendered = setup(true)
  emitAndFrame(rendered.fake, 244)
  return rendered
}

describe('turning it on', () => {
  test('enable() is called synchronously inside toggle()', () => {
    const { fake, result } = setup()

    result.current.toggle()

    expect(fake.enable).toHaveBeenCalledOnce()
  })

  test("granted: onChange(true), then a watch", async () => {
    const { fake, result, onChange, onNotice } = setup()

    act(() => result.current.toggle())
    expect(fake.watch).not.toHaveBeenCalled()
    await answer(fake, 'granted')

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
    expect(fake.activeCount()).toBe(1)
    expect(onNotice).not.toHaveBeenCalled()
  })

  test.each([
    ['denied', 'compassDenied'],
    ['unsupported', 'compassMissing'],
  ] as const)('%s: stays off, notice %s', async (permission, notice) => {
    const { fake, result, onChange, onNotice } = setup()

    act(() => result.current.toggle())
    await answer(fake, permission)

    expect(onChange).not.toHaveBeenCalled()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith(notice)
    expect(fake.watch).not.toHaveBeenCalled()
  })

  test('a second toggle while enable() is pending does nothing', async () => {
    const { fake, result, onChange } = setup()

    act(() => result.current.toggle())
    act(() => result.current.toggle())
    expect(fake.enable).toHaveBeenCalledOnce()

    await answer(fake, 'granted')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  test('an answer after unmount does nothing', async () => {
    const { fake, result, onChange, onNotice, unmount } = setup()

    act(() => result.current.toggle())
    unmount()
    await answer(fake, 'granted')

    expect(onChange).not.toHaveBeenCalled()
    expect(onNotice).not.toHaveBeenCalled()
    expect(fake.watch).not.toHaveBeenCalled()
  })

  test('on at mount: listens without enable()', () => {
    const { fake } = setup(true)

    expect(fake.enable).not.toHaveBeenCalled()
    expect(fake.activeCount()).toBe(1)
  })

  test('enable() again on every off → on', async () => {
    const { fake, result } = setup()

    act(() => result.current.toggle())
    await answer(fake, 'granted')
    act(() => result.current.toggle())
    act(() => result.current.toggle())

    expect(fake.enable).toHaveBeenCalledTimes(2)
  })
})

describe('delivering the heading', () => {
  test('no source before the first delivery', () => {
    const { fake, result } = setup(true)

    act(() => fake.emit(244))

    expect(result.current.source).toBeNull()
  })

  test('244 magnetic: the source delivers 228 after a frame', () => {
    const { fake, result } = setup(true)

    act(() => fake.emit(244))
    expect(result.current.source).toBeNull()
    act(() => vi.advanceTimersToNextFrame())

    expect(result.current.source?.current()).toBeCloseTo(228, 9)
  })

  test('two emits in one frame: one delivery, the last', () => {
    const { fake, deliveries } = delivering()
    const got = deliveries()

    act(() => {
      fake.emit(100)
      fake.emit(120)
      vi.advanceTimersToNextFrame()
    })

    expect(got).toEqual([104])
  })

  test('a move under 1° is not delivered; 1° or more from the last delivered is', () => {
    const { fake, deliveries, result } = delivering()
    const got = deliveries()

    // 228.6 true: 0.6° from 228.
    emitAndFrame(fake, 244.6)
    expect(got).toEqual([])
    expect(result.current.source?.current()).toBeCloseTo(228, 9)

    // 229.5 true: 1.5° from 228, the last delivered.
    emitAndFrame(fake, 245.5)
    expect(got).toHaveLength(1)
    expect(got[0]).toBeCloseTo(229.5, 9)
  })

  test('the threshold goes the short way round 0°', () => {
    const { fake, deliveries } = setup(true)
    emitAndFrame(fake, 16) // 0 true
    const got = deliveries()

    emitAndFrame(fake, 15.5) // 359.5 true: 0.5° away
    expect(got).toEqual([])
    emitAndFrame(fake, 14.5) // 358.5 true: 1.5° away
    expect(got).toEqual([358.5])
  })

  test('declinationAt gets the centre at the moment listening starts', async () => {
    const { fake, declinationAt, moveCenter, result } = setup()
    moveCenter({ latitude: -20, longitude: -40 })

    act(() => result.current.toggle())
    // Moved again while the answer is pending: the centre counts when listening starts.
    moveCenter({ latitude: -21, longitude: -41 })
    await answer(fake, 'granted')

    expect(declinationAt).toHaveBeenCalledExactlyOnceWith(-21, -41)
  })

  test('a new listening period computes the declination again, at the new centre', () => {
    const { declinationAt, moveCenter } = setup(true)
    expect(declinationAt).toHaveBeenCalledExactlyOnceWith(BLUMENAU.latitude, BLUMENAU.longitude)
    moveCenter({ latitude: -3, longitude: -60 })

    setVisibility('hidden')
    setVisibility('visible')

    expect(declinationAt.mock.calls).toEqual([
      [BLUMENAU.latitude, BLUMENAU.longitude],
      [-3, -60],
    ])
  })

  test('no centre yet: does not listen (never with a declination of 0)', () => {
    const fake = createFakeHeading()
    const declinationAt = vi.fn(() => DECLINATION)
    renderHook(() =>
      useCompass({
        heading: fake.port,
        on: true,
        onChange: () => {},
        onNotice: () => {},
        declinationAt,
        center: () => null,
      }),
    )

    expect(fake.watch).not.toHaveBeenCalled()
    expect(declinationAt).not.toHaveBeenCalled()
  })
})

describe('no compass (3 s)', () => {
  test('3 s without a heading: compassMissing and off', () => {
    const { fake, onChange, onNotice, result } = setup(true)

    act(() => vi.advanceTimersByTime(2999))
    expect(onNotice).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))

    expect(onNotice).toHaveBeenCalledExactlyOnceWith('compassMissing')
    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(result.current.on).toBe(false)
    expect(fake.activeCount()).toBe(0)
  })

  test('a heading before 3 s cancels it', () => {
    const { fake, onNotice, onChange } = setup(true)

    act(() => vi.advanceTimersByTime(2000))
    act(() => fake.emit(244))
    act(() => vi.advanceTimersByTime(5000))

    expect(onNotice).not.toHaveBeenCalled()
    expect(onChange).not.toHaveBeenCalled()
    expect(fake.activeCount()).toBe(1)
  })
})

describe('page visibility', () => {
  test('hidden: stops, the source goes, no timer runs out', () => {
    const { fake, result, onNotice } = delivering()

    setVisibility('hidden')

    expect(fake.activeCount()).toBe(0)
    expect(result.current.source).toBeNull()
    act(() => vi.advanceTimersByTime(10_000))
    expect(onNotice).not.toHaveBeenCalled()
    expect(result.current.on).toBe(true)
  })

  test('hidden at mount: listens only when visible', () => {
    visibility = 'hidden'
    const { fake } = setup(true)
    expect(fake.watch).not.toHaveBeenCalled()

    setVisibility('visible')

    expect(fake.activeCount()).toBe(1)
  })

  test('visible again: listens again, with a new source and a new 3 s', () => {
    const { fake, result, onNotice } = delivering()
    const first = result.current.source
    setVisibility('hidden')

    setVisibility('visible')

    expect(fake.watch).toHaveBeenCalledTimes(2)
    expect(fake.activeCount()).toBe(1)
    emitAndFrame(fake, 244)
    expect(result.current.source).not.toBeNull()
    expect(result.current.source).not.toBe(first)

    setVisibility('hidden')
    setVisibility('visible')
    act(() => vi.advanceTimersByTime(3000))
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('compassMissing')
  })
})

describe('only in portrait', () => {
  test('to landscape while on: stops, source null, compassLandscape; back to portrait: listens again', () => {
    const orientation = stubOrientation(false)
    const { fake, result, onNotice, onChange } = delivering()
    expect(result.current.landscape).toBe(false)

    orientation.turn('landscape')

    expect(orientation.matchMedia).toHaveBeenCalledWith('(orientation: landscape)')
    expect(result.current.landscape).toBe(true)
    expect(fake.activeCount()).toBe(0)
    expect(result.current.source).toBeNull()
    expect(onNotice).toHaveBeenCalledExactlyOnceWith('compassLandscape')
    // No 3 s timer in landscape.
    act(() => vi.advanceTimersByTime(10_000))
    expect(onNotice).toHaveBeenCalledOnce()
    expect(onChange).not.toHaveBeenCalled()

    orientation.turn('portrait')

    expect(result.current.landscape).toBe(false)
    expect(fake.activeCount()).toBe(1)
    expect(fake.enable).not.toHaveBeenCalled()
  })

  test('turned on in landscape: compassLandscape after granted, no listening', async () => {
    stubOrientation(true)
    const { fake, result, onNotice } = setup()

    act(() => result.current.toggle())
    expect(onNotice).not.toHaveBeenCalled()
    await answer(fake, 'granted')

    expect(onNotice).toHaveBeenCalledExactlyOnceWith('compassLandscape')
    expect(fake.watch).not.toHaveBeenCalled()
  })

  test('opened in landscape with the compass on: compassLandscape, no listening', () => {
    stubOrientation(true)
    const { fake, onNotice } = setup(true)

    expect(onNotice).toHaveBeenCalledExactlyOnceWith('compassLandscape')
    expect(fake.watch).not.toHaveBeenCalled()
  })

  test('landscape while off: nothing', () => {
    const orientation = stubOrientation(false)
    const { onNotice } = setup()

    orientation.turn('landscape')

    expect(onNotice).not.toHaveBeenCalled()
  })

  test('a tap in landscape turns it off', () => {
    stubOrientation(true)
    const { fake, result, onChange } = setup(true)

    act(() => result.current.toggle())

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(fake.enable).not.toHaveBeenCalled()
  })
})

describe('turning it off and unmount', () => {
  test('toggle while on: stops, onChange(false), no enable()', () => {
    const { fake, result, onChange } = delivering()

    act(() => result.current.toggle())

    expect(onChange).toHaveBeenCalledExactlyOnceWith(false)
    expect(fake.enable).not.toHaveBeenCalled()
    expect(fake.activeCount()).toBe(0)
    expect(result.current.source).toBeNull()
  })

  test('nothing listens after unmount, and the pending frame is cancelled', () => {
    const { fake, unmount, deliveries } = delivering()
    const got = deliveries()
    act(() => fake.emit(100))

    unmount()
    vi.advanceTimersToNextFrame()

    expect(fake.activeCount()).toBe(0)
    expect(got).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })
})
