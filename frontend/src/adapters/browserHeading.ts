import type { HeadingPermission, HeadingPort } from '../core/ports'

/**
 * The part of `window` the compass uses, so tests can pass their own. DeviceOrientationEvent is
 * only an object here: its iOS-only static requestPermission is not in the DOM types.
 */
export interface HeadingEnvironment {
  readonly DeviceOrientationEvent?: object
  addEventListener(type: 'deviceorientation', listener: (event: Event) => void): void
  removeEventListener(type: 'deviceorientation', listener: (event: Event) => void): void
}

/** iOS Safari's DeviceOrientationEvent (13+): permission is asked for, inside a tap. */
interface PermissionRequesting {
  requestPermission(): Promise<string>
}

function asksForPermission(eventClass: object): eventClass is PermissionRequesting {
  return 'requestPermission' in eventClass && typeof eventClass.requestPermission === 'function'
}

/**
 * The device's compass behind the core port (decision W9 of slice F4-5), from Safari's
 * webkitCompassHeading: degrees clockwise from magnetic north, of the device's top edge
 * (measured on an iPhone, 2026-11-27). Android and desktop browsers do not send it; there the
 * map's 3 s timer reports "no compass".
 */
export function createBrowserHeading(env: HeadingEnvironment): HeadingPort {
  return {
    // Not async on purpose: iOS refuses requestPermission outside a user gesture, and an
    // await before the call would move it out of the tap. It is called before this returns.
    enable() {
      const eventClass = env.DeviceOrientationEvent
      if (eventClass === undefined) return Promise.resolve<HeadingPermission>('unsupported')
      // Android, desktop: no permission to ask for.
      if (!asksForPermission(eventClass)) return Promise.resolve<HeadingPermission>('granted')
      let request: Promise<string>
      try {
        request = eventClass.requestPermission()
      } catch {
        return Promise.resolve<HeadingPermission>('denied')
      }
      // Safari rejects when called outside a gesture: for the user, the same as a refusal.
      return request.then(
        (answer): HeadingPermission => (answer === 'granted' ? 'granted' : 'denied'),
        (): HeadingPermission => 'denied',
      )
    },

    watch(onHeading) {
      // The browser may deliver one queued event after removeEventListener: nothing gets past this.
      let active = true
      const listener = (event: Event) => {
        if (!active || !('webkitCompassHeading' in event)) return
        const value = event.webkitCompassHeading
        // Safari sends null or -1 before the compass is calibrated.
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 360) return
        onHeading(value)
      }
      env.addEventListener('deviceorientation', listener)
      return () => {
        if (!active) return
        active = false
        env.removeEventListener('deviceorientation', listener)
      }
    },
  }
}
