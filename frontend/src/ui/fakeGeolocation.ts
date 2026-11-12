import { vi } from 'vitest'
import type { GeoFailure, GeoReading, GeolocationPort } from '../core/ports'

// Test helper. A GeolocationPort the test drives: emit readings and failures to every watch
// not stopped yet; watch and stop are spies. Wrap emit/fail in act() when a screen listens.

interface Watcher {
  readonly onReading: (reading: GeoReading) => void
  readonly onFailure: (failure: GeoFailure) => void
  stopped: boolean
}

export function createFakeGeolocation() {
  const watchers: Watcher[] = []
  /** Every call of a stop function returned by watch, idempotent ones included. */
  const stop = vi.fn<() => void>()
  const watch = vi.fn<GeolocationPort['watch']>((onReading, onFailure) => {
    const watcher: Watcher = { onReading, onFailure, stopped: false }
    watchers.push(watcher)
    return () => {
      watcher.stopped = true
      stop()
    }
  })
  const active = () => watchers.filter((watcher) => !watcher.stopped)

  return {
    port: { watch } satisfies GeolocationPort,
    watch,
    stop,
    /** Watches started and not stopped. */
    activeCount: () => active().length,
    emit(reading: GeoReading) {
      for (const watcher of active()) watcher.onReading(reading)
    },
    fail(failure: GeoFailure) {
      for (const watcher of active()) watcher.onFailure(failure)
    },
  }
}
