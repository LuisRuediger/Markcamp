import type { GeolocationPort } from '../core/ports'

// GeolocationPositionError codes. Literal numbers, not the constants on the error object:
// they are the same in every browser, and a test's fake error needs nothing more than `code`.
const PERMISSION_DENIED = 1
const POSITION_UNAVAILABLE = 2
// TIMEOUT (3) is ignored: no timeout is passed, so a browser that still reports one is only
// saying "no fix yet". Keep waiting.

/**
 * navigator.geolocation behind the core port (decision J3 of slice F3). The geolocation object
 * is a parameter so tests can pass their own; undefined when the device has none.
 *
 * Readings are passed through as reported: deciding which ones are usable is core's job
 * (geoReading.ts).
 */
export function createBrowserGeolocation(geolocation: Geolocation | undefined): GeolocationPort {
  return {
    watch(onReading, onFailure) {
      // A browser may deliver one queued callback after clearWatch: nothing gets past this.
      let active = true

      if (geolocation === undefined) {
        // Asynchronous, like a real failure: the port promises no callback before watch() returns.
        queueMicrotask(() => {
          if (!active) return
          active = false
          onFailure('unsupported')
        })
        return () => {
          active = false
        }
      }

      // A const, so the closure below sees it as defined.
      const device = geolocation
      let watchId: number | null = null
      function clear(): void {
        if (watchId === null) return
        device.clearWatch(watchId)
        watchId = null
      }

      // The browser queues these callbacks as tasks (W3C Geolocation), so none runs before
      // watchPosition returns and watchId is set.
      watchId = device.watchPosition(
        (position) => {
          if (!active) return
          onReading({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyM: position.coords.accuracy,
          })
        },
        (error) => {
          if (!active) return
          if (error.code === PERMISSION_DENIED) {
            active = false
            clear()
            onFailure('denied')
          } else if (error.code === POSITION_UNAVAILABLE) {
            onFailure('unavailable')
          }
        },
        // No timeout: the default is none, and under canopy a fix may take minutes.
        // maximumAge 0: a cached position from somewhere else must not become a bait site.
        { enableHighAccuracy: true, maximumAge: 0 },
      )

      return () => {
        active = false
        clear()
      }
    },
  }
}
