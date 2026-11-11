import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createBrowserTimers } from './browserTimers'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

test('calls back once, after the delay', () => {
  const callback = vi.fn()
  createBrowserTimers().after(60_000, callback)

  vi.advanceTimersByTime(59_999)
  expect(callback).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(callback).toHaveBeenCalledOnce()
  vi.advanceTimersByTime(120_000)
  expect(callback).toHaveBeenCalledOnce()
})

test('the cancel function prevents the call', () => {
  const callback = vi.fn()
  const cancel = createBrowserTimers().after(60_000, callback)

  cancel()
  vi.advanceTimersByTime(60_000)

  expect(callback).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
