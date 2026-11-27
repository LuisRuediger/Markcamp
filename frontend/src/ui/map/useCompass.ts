import { useEffect, useRef, useState } from 'react'
import { headingDelta, trueHeading } from '../../core/heading'
import type { HeadingPort } from '../../core/ports'

// The compass of the map (decisions W4 to W11 of slice F4-5). On/off belongs to App (memory
// only, like the saved map view); this hook asks for the permission on a tap and listens
// only while on, the map is mounted, the page is visible and the screen is in portrait.
//
// The heading never goes through React state: deviceorientation fires tens of times a second.
// It goes to subscribers (the rose, the cone), at most once per animation frame and only when
// it moved by 1° or more. Like the position, it is never stored or logged.

/** No heading this long after listening starts: this device has no compass (W7). */
const NO_HEADING_MS = 3000
/** A smaller move is not delivered: the rose and the cone would only shiver. */
const MIN_DELIVERED_MOVE_DEG = 1

export type CompassNotice = 'compassDenied' | 'compassMissing' | 'compassLandscape'

/** True headings for the rose and the cone, one object per listening period. */
export interface HeadingSource {
  /** The listener gets every delivered true heading. Returns an unsubscribe function. */
  subscribe(listener: (trueDeg: number) => void): () => void
  /** The last delivered true heading: a late subscriber starts right. */
  current(): number | null
}

export interface CompassOptions {
  heading: HeadingPort
  /** Kept by App, so it outlives this screen within a run. */
  on: boolean
  onChange(on: boolean): void
  onNotice(notice: CompassNotice): void
  /** Magnetic declination at a point, for now. */
  declinationAt(latitude: number, longitude: number): number
  /** The map's centre; null before the map exists. */
  center(): { latitude: number; longitude: number } | null
}

export interface Compass {
  toggle(): void
  /** The screen is in landscape: no listening, the rose fades (W11). */
  landscape: boolean
  /** Non-null only while on, listening, in portrait, and after the first delivery. */
  source: HeadingSource | null
}

const LANDSCAPE_QUERY = '(orientation: landscape)'

/** null where there is no matchMedia (jsdom): portrait. */
function landscapeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(LANDSCAPE_QUERY) : null
}

export function useCompass({ heading, on, onChange, onNotice, declinationAt, center }: CompassOptions): Compass {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  const [landscape, setLandscape] = useState(() => landscapeQuery()?.matches ?? false)
  const [source, setSource] = useState<HeadingSource | null>(null)
  // An enable() not answered yet: another tap does nothing.
  const enabling = useRef(false)
  const mounted = useRef(true)
  // The latest callbacks, for code that runs later (the timer, an answer, a listening start).
  // Updated in the first effect, so the effects below always read this render's values.
  const latest = useRef({ onChange, onNotice, declinationAt, center })

  useEffect(() => {
    latest.current = { onChange, onNotice, declinationAt, center }
  })

  useEffect(() => {
    mounted.current = true
    const onVisibilityChange = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVisibilityChange)
    const query = landscapeQuery()
    const onOrientationChange = () => setLandscape(query?.matches ?? false)
    query?.addEventListener('change', onOrientationChange)
    return () => {
      mounted.current = false
      document.removeEventListener('visibilitychange', onVisibilityChange)
      query?.removeEventListener('change', onOrientationChange)
    }
  }, [])

  // Turned to landscape while on, turned on in landscape, or opened in landscape while on.
  useEffect(() => {
    if (on && landscape) latest.current.onNotice('compassLandscape')
  }, [on, landscape])

  // One listening period per run of this effect.
  useEffect(() => {
    if (!on || !visible || landscape) return
    // Never with a declination of 0: wait for a later start. The map is created in a child
    // effect, which runs before this one, so this is not expected to happen.
    const middle = latest.current.center()
    if (middle === null) return
    // At the map's centre, not the GPS: the compass works with location denied, and the
    // declination changes about 1° per hundreds of kilometres.
    const declination = latest.current.declinationAt(middle.latitude, middle.longitude)

    let active = true
    const listeners = new Set<(trueDeg: number) => void>()
    let delivered: number | null = null
    let waiting: number | null = null
    let frame: number | null = null
    let published = false
    const period: HeadingSource = {
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      current: () => delivered,
    }

    let noHeading: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      noHeading = null
      if (!active) return
      latest.current.onNotice('compassMissing')
      latest.current.onChange(false)
    }, NO_HEADING_MS)

    function deliver() {
      frame = null
      const next = waiting
      waiting = null
      if (!active || next === null) return
      if (delivered !== null && headingDelta(next, delivered) < MIN_DELIVERED_MOVE_DEG) return
      delivered = next
      if (!published) {
        // The only render of the period: the rose and the cone subscribe now.
        published = true
        setSource(period)
      }
      for (const listener of [...listeners]) listener(next)
    }

    const stop = heading.watch((magneticDeg) => {
      if (!active) return
      if (noHeading !== null) {
        clearTimeout(noHeading)
        noHeading = null
      }
      // Only the last heading of a frame counts.
      waiting = trueHeading(magneticDeg, declination)
      if (frame === null) frame = requestAnimationFrame(deliver)
    })

    return () => {
      active = false
      stop()
      if (frame !== null) cancelAnimationFrame(frame)
      if (noHeading !== null) clearTimeout(noHeading)
      setSource(null)
    }
  }, [heading, on, visible, landscape])

  function toggle() {
    if (enabling.current) return
    if (on) {
      onChange(false)
      return
    }
    enabling.current = true
    // First, with nothing awaited before it: iOS asks only inside the tap. Called on every
    // off → on; after the first answer iOS repeats it at once, without asking.
    const answer = heading.enable()
    void answer.then((permission) => {
      enabling.current = false
      if (!mounted.current) return
      switch (permission) {
        case 'granted':
          latest.current.onChange(true)
          return
        case 'denied':
          latest.current.onNotice('compassDenied')
          return
        case 'unsupported':
          latest.current.onNotice('compassMissing')
          return
      }
    })
  }

  return { toggle, landscape, source }
}
