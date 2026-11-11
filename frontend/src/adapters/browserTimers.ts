import type { Timers } from '../core/ports'

export function createBrowserTimers(): Timers {
  return {
    after(ms, callback) {
      const id = setTimeout(callback, ms)
      return () => clearTimeout(id)
    },
  }
}
