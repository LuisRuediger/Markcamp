import type { AppLifecycle } from '../core/ports'

/** The window and document are parameters so tests can pass their own. */
export function createBrowserLifecycle(target: Window = window, doc: Document = document): AppLifecycle {
  return {
    onOnline(listener) {
      const handler = () => listener()
      target.addEventListener('online', handler)
      return () => target.removeEventListener('online', handler)
    },
    onForeground(listener) {
      // On the iPhone the installed app is rarely started from scratch: coming back to it is
      // the real "app open". 'hidden' (going to the background) is not a trigger.
      const handler = () => {
        if (doc.visibilityState === 'visible') listener()
      }
      doc.addEventListener('visibilitychange', handler)
      return () => doc.removeEventListener('visibilitychange', handler)
    },
  }
}
