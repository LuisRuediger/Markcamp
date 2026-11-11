/** Rejection reason of withTimeout when the limit is reached first. */
export class TimeoutError extends Error {
  constructor() {
    super('Operation timed out.')
    this.name = 'TimeoutError'
  }
}

/**
 * Settles like `work`, or rejects with TimeoutError after `ms`, whichever comes first. The
 * timer is cleared as soon as `work` settles. `onTimeout` runs right after the rejection, to
 * cancel the work if it can be cancelled (e.g. abort a fetch).
 *
 * The work itself keeps running unless onTimeout stops it; its late result is ignored. Every
 * sync request needs a limit (ADR 0008, rule 5): on weak signal a request or a token refresh
 * may never settle, and the single-flight sync engine would wait on it forever.
 */
export function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void = () => {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError())
      onTimeout()
    }, ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
