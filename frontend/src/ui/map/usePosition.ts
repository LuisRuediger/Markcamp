import { useEffect, useState } from 'react'
import { isUsableReading } from '../../core/geoReading'
import type { GeoReading, GeolocationPort } from '../../core/ports'

// The device's position for the map (decisions U2 and U3 of slice F4-3). The GPS runs only
// while the map is mounted and the page is visible: hidden stops it and forgets the position
// (a dot left from before shows a place the user may no longer be at, and iOS does not promise
// to resume a watch), visible starts it again. The position lives only in this state: never
// stored, queued or logged.

export type PositionState =
  | { readonly status: 'searching' }
  | { readonly status: 'located'; readonly reading: GeoReading }
  | { readonly status: 'denied' }
  | { readonly status: 'unsupported' }

const SEARCHING: PositionState = { status: 'searching' }

export function usePosition(geolocation: GeolocationPort): PositionState {
  const [state, setState] = useState<PositionState>(SEARCHING)

  useEffect(() => {
    let stop: (() => void) | null = null
    // 'unsupported' is for good: this mount never watches again.
    let unsupported = false
    // The port already promises no callback after stop; this also covers a stop missed by a bug.
    let mounted = true

    function halt() {
      stop?.()
      stop = null
    }

    function start() {
      if (stop !== null || unsupported) return
      // The same object when already searching: no render at mount.
      setState(SEARCHING)
      stop = geolocation.watch(
        (reading) => {
          // The last usable reading, not the best: walking, the last one is where the user is.
          if (mounted && isUsableReading(reading)) setState({ status: 'located', reading })
        },
        (failure) => {
          if (!mounted) return
          switch (failure) {
            case 'unavailable':
              // Still watching; a dot already shown stays.
              return
            case 'denied':
              // No more callbacks (the port's contract); stopped here too, so the next
              // "visible" starts a new watch: the user may have just allowed it in Settings.
              halt()
              setState({ status: 'denied' })
              return
            case 'unsupported':
              unsupported = true
              halt()
              setState({ status: 'unsupported' })
              return
          }
        },
      )
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        start()
        return
      }
      halt()
      if (!unsupported) setState(SEARCHING)
    }

    document.addEventListener('visibilitychange', onVisibilityChange)
    if (document.visibilityState === 'visible') start()
    return () => {
      mounted = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      halt()
    }
  }, [geolocation])

  return state
}
