import { afterEach, expect, test, vi } from 'vitest'
import { declinationDeg } from './declination'

afterEach(() => {
  vi.restoreAllMocks()
})

test('Blumenau on 2026-11-27: WMM2025 gives -20.064°, within 0.5°', () => {
  const errors = vi.spyOn(console, 'error')

  const decl = declinationDeg(-26.92, -49.07, new Date('2026-11-27T12:00:00Z'))

  expect(decl).toBeGreaterThan(-20.56)
  expect(decl).toBeLessThan(-19.56)
  // Inside WMM2025: no reminder.
  expect(errors).not.toHaveBeenCalled()
})

test('2030, past WMM2025: a finite number, no throw, and the package’s console reminder', () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})

  const decl = declinationDeg(-26.92, -49.07, new Date('2030-06-01T12:00:00Z'))

  expect(Number.isFinite(decl)).toBe(true)
  expect(errors).toHaveBeenCalled()
})
