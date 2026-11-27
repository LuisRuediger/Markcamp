import { describe, expect, test, vi } from 'vitest'
import { createBrowserHeading, type HeadingEnvironment } from './browserHeading'

/** A window the test drives: it keeps the deviceorientation listeners. No real browser API. */
function fakeWindow(eventClass?: object) {
  const listeners: ((event: Event) => void)[] = []
  const addEventListener = vi.fn<HeadingEnvironment['addEventListener']>((_type, listener) => {
    listeners.push(listener)
  })
  const removeEventListener = vi.fn<HeadingEnvironment['removeEventListener']>((_type, listener) => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  })
  const env: HeadingEnvironment =
    eventClass === undefined
      ? { addEventListener, removeEventListener }
      : { DeviceOrientationEvent: eventClass, addEventListener, removeEventListener }
  return {
    env,
    addEventListener,
    removeEventListener,
    listenerCount: () => listeners.length,
    /** A deviceorientation event as Safari sends it; undefined leaves the property out. */
    orient(heading: unknown) {
      const event = new Event('deviceorientation')
      const sent = heading === undefined ? event : Object.assign(event, { webkitCompassHeading: heading })
      for (const listener of [...listeners]) listener(sent)
    },
  }
}

describe('enable', () => {
  test("no DeviceOrientationEvent: 'unsupported'", async () => {
    const { env } = fakeWindow()

    expect(await createBrowserHeading(env).enable()).toBe('unsupported')
  })

  test.each(['granted', 'denied'] as const)(
    "requestPermission is called before enable() returns; '%s' passes through",
    async (answer) => {
      const requestPermission = vi.fn(() => Promise.resolve<string>(answer))
      const { env } = fakeWindow({ requestPermission })

      const result = createBrowserHeading(env).enable()
      // Before any await: on iOS a call after one would be outside the tap.
      expect(requestPermission).toHaveBeenCalledOnce()

      expect(await result).toBe(answer)
    },
  )

  test("a rejected requestPermission (Safari, outside a gesture): 'denied'", async () => {
    const requestPermission = vi.fn(() => Promise.reject<string>(new Error('NotAllowedError')))
    const { env } = fakeWindow({ requestPermission })

    expect(await createBrowserHeading(env).enable()).toBe('denied')
  })

  test("no requestPermission (Android, desktop): 'granted'", async () => {
    const { env } = fakeWindow({})

    expect(await createBrowserHeading(env).enable()).toBe('granted')
  })
})

describe('watch', () => {
  test('delivers webkitCompassHeading', () => {
    const fake = fakeWindow({})
    const headings: number[] = []
    createBrowserHeading(fake.env).watch((deg) => headings.push(deg))

    fake.orient(244.9)
    fake.orient(0)
    fake.orient(359.9)

    expect(headings).toEqual([244.9, 0, 359.9])
    expect(fake.addEventListener).toHaveBeenCalledOnce()
    expect(fake.addEventListener.mock.calls[0]?.[0]).toBe('deviceorientation')
  })

  test.each([null, undefined, -1, Number.NaN, 360, Number.POSITIVE_INFINITY, '244'])('skips %s', (value) => {
    const fake = fakeWindow({})
    const headings: number[] = []
    createBrowserHeading(fake.env).watch((deg) => headings.push(deg))

    fake.orient(value)

    expect(headings).toEqual([])
  })

  test('nothing after stop, even an event the browser had queued', () => {
    const fake = fakeWindow({})
    const headings: number[] = []
    const stop = createBrowserHeading(fake.env).watch((deg) => headings.push(deg))
    const call = fake.addEventListener.mock.calls[0]
    if (call === undefined) throw new Error('no listener')
    const [, listener] = call

    stop()
    fake.orient(100)
    // Straight to the listener, as a queued event would.
    listener(Object.assign(new Event('deviceorientation'), { webkitCompassHeading: 100 }))

    expect(headings).toEqual([])
  })

  test('stop twice removes the listener once, the same function that was added', () => {
    const fake = fakeWindow({})
    const stop = createBrowserHeading(fake.env).watch(() => {})

    stop()
    stop()

    expect(fake.removeEventListener).toHaveBeenCalledOnce()
    const added = fake.addEventListener.mock.calls[0]?.[1]
    expect(fake.removeEventListener.mock.calls[0]).toEqual(['deviceorientation', added])
    expect(fake.listenerCount()).toBe(0)
  })
})
