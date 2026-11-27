import { vi } from 'vitest'
import type { HeadingPermission, HeadingPort } from '../core/ports'

// Test helper. A HeadingPort the test drives: enable() stays pending until the test answers it
// (or forever); emit headings to every watch not stopped yet; enable, watch and stop are spies.
// Wrap emit and answer in act() when a screen listens.

interface Watcher {
  readonly onHeading: (magneticDeg: number) => void
  stopped: boolean
}

export function createFakeHeading() {
  const watchers: Watcher[] = []
  let pending: ((permission: HeadingPermission) => void)[] = []
  const enable = vi.fn<HeadingPort['enable']>(
    () =>
      new Promise<HeadingPermission>((resolve) => {
        pending.push(resolve)
      }),
  )
  /** Every call of a stop function returned by watch, idempotent ones included. */
  const stop = vi.fn<() => void>()
  const watch = vi.fn<HeadingPort['watch']>((onHeading) => {
    const watcher: Watcher = { onHeading, stopped: false }
    watchers.push(watcher)
    return () => {
      watcher.stopped = true
      stop()
    }
  })
  const active = () => watchers.filter((watcher) => !watcher.stopped)

  return {
    port: { enable, watch } satisfies HeadingPort,
    enable,
    watch,
    stop,
    /** Watches started and not stopped. */
    activeCount: () => active().length,
    /** Resolves every enable() call still pending with this answer. */
    answer(permission: HeadingPermission) {
      const waiting = pending
      pending = []
      for (const resolve of waiting) resolve(permission)
    },
    emit(magneticDeg: number) {
      for (const watcher of active()) watcher.onHeading(magneticDeg)
    },
  }
}
