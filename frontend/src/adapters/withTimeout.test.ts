import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { TimeoutError, withTimeout } from './withTimeout'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('withTimeout', () => {
  test('settles with the value and clears its timer', async () => {
    await expect(withTimeout(Promise.resolve('token'), 1_000)).resolves.toBe('token')
    expect(vi.getTimerCount()).toBe(0)
  })

  test('rejects with the original rejection and clears its timer', async () => {
    const original = new Error('refresh failed')
    await expect(withTimeout(Promise.reject(original), 1_000)).rejects.toBe(original)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('rejects with TimeoutError when the work never settles, then calls onTimeout', async () => {
    const onTimeout = vi.fn()
    const result = withTimeout(new Promise<string>(() => {}), 1_000, onTimeout)
    const settled = result.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(999)
    expect(onTimeout).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(await settled).toBeInstanceOf(TimeoutError)
    expect(onTimeout).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  test('a late rejection after the timeout is ignored, not unhandled', async () => {
    let fail!: (error: Error) => void
    const work = new Promise<string>((_, reject) => (fail = reject))
    const settled = withTimeout(work, 10).catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(10)
    fail(new Error('aborted'))
    await vi.advanceTimersByTimeAsync(0)

    expect(await settled).toBeInstanceOf(TimeoutError)
  })
})
