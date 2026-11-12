import { describe, expect, test, vi } from 'vitest'
import type { GeoFailure, GeoReading } from '../core/ports'
import { createBrowserGeolocation } from './browserGeolocation'

const WATCH_ID = 7

/** A Geolocation the test drives: it keeps the callbacks watchPosition received. No real browser API. */
function fakeGeolocation() {
  let success: PositionCallback = () => {}
  let failure: PositionErrorCallback | null = null
  const watchPosition = vi.fn<Geolocation['watchPosition']>((onSuccess, onError) => {
    success = onSuccess
    failure = onError ?? null
    return WATCH_ID
  })
  const clearWatch = vi.fn<Geolocation['clearWatch']>()
  const geolocation: Geolocation = { watchPosition, clearWatch, getCurrentPosition: vi.fn() }

  return {
    geolocation,
    watchPosition,
    clearWatch,
    position(latitude: number, longitude: number, accuracy: number) {
      const coords: GeolocationCoordinates = {
        latitude,
        longitude,
        accuracy,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        toJSON: () => ({}),
      }
      success({ coords, timestamp: 0, toJSON: () => ({}) })
    },
    error(code: number) {
      failure?.({ code, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })
    },
  }
}

function watch(geolocation: Geolocation | undefined) {
  const readings: GeoReading[] = []
  const failures: GeoFailure[] = []
  const stop = createBrowserGeolocation(geolocation).watch(
    (reading) => readings.push(reading),
    (failure) => failures.push(failure),
  )
  return { readings, failures, stop }
}

describe('browser geolocation adapter', () => {
  test('watchPosition gets high accuracy, maximumAge 0 and no timeout', () => {
    const fake = fakeGeolocation()
    watch(fake.geolocation)

    expect(fake.watchPosition).toHaveBeenCalledOnce()
    const options = fake.watchPosition.mock.calls[0]?.[2]
    expect(options).toEqual({ enableHighAccuracy: true, maximumAge: 0 })
    expect(options !== undefined && 'timeout' in options).toBe(false)
  })

  test('a position gives a reading with the three fields, as reported', () => {
    const fake = fakeGeolocation()
    const { readings, failures } = watch(fake.geolocation)

    fake.position(-27.1, -49.1, 12.5)

    expect(readings).toEqual([{ latitude: -27.1, longitude: -49.1, accuracyM: 12.5 }])
    expect(failures).toEqual([])
  })

  test("code 1 (PERMISSION_DENIED): 'denied' and clearWatch; nothing after it", () => {
    const fake = fakeGeolocation()
    const { readings, failures } = watch(fake.geolocation)

    fake.error(1)
    expect(failures).toEqual(['denied'])
    expect(fake.clearWatch).toHaveBeenCalledExactlyOnceWith(WATCH_ID)

    fake.position(-27.1, -49.1, 5)
    fake.error(1)
    expect(readings).toEqual([])
    expect(failures).toEqual(['denied'])
  })

  test("code 2 (POSITION_UNAVAILABLE): 'unavailable', still watching", () => {
    const fake = fakeGeolocation()
    const { readings, failures } = watch(fake.geolocation)

    fake.error(2)
    expect(failures).toEqual(['unavailable'])
    expect(fake.clearWatch).not.toHaveBeenCalled()

    fake.position(-27.1, -49.1, 5)
    expect(readings).toHaveLength(1)
  })

  test('code 3 (TIMEOUT): nothing', () => {
    const fake = fakeGeolocation()
    const { readings, failures } = watch(fake.geolocation)

    fake.error(3)

    expect(failures).toEqual([])
    expect(readings).toEqual([])
    expect(fake.clearWatch).not.toHaveBeenCalled()
  })

  test("no geolocation: 'unsupported', not before watch returns", async () => {
    const { failures } = watch(undefined)

    expect(failures).toEqual([])
    await Promise.resolve()
    expect(failures).toEqual(['unsupported'])
  })

  test("no geolocation, stopped at once: 'unsupported' is never delivered", async () => {
    const { failures, stop } = watch(undefined)

    stop()
    await Promise.resolve()

    expect(failures).toEqual([])
  })

  test('nothing is delivered after stop(), even a callback the browser had queued', () => {
    const fake = fakeGeolocation()
    const { readings, failures, stop } = watch(fake.geolocation)

    stop()
    fake.position(-27.1, -49.1, 5)
    fake.error(2)
    fake.error(1)

    expect(readings).toEqual([])
    expect(failures).toEqual([])
  })

  test('stop() twice calls clearWatch once; stop() after a denial does not call it again', () => {
    const fake = fakeGeolocation()
    const first = watch(fake.geolocation)
    first.stop()
    first.stop()
    expect(fake.clearWatch).toHaveBeenCalledExactlyOnceWith(WATCH_ID)

    const other = fakeGeolocation()
    const second = watch(other.geolocation)
    other.error(1)
    second.stop()
    expect(other.clearWatch).toHaveBeenCalledOnce()
  })
})
