import { describe, expect, test } from 'vitest'
import { headingDelta, trueHeading } from './heading'

describe('trueHeading', () => {
  test.each([
    [244, -16, 228],
    [5, -16, 349],
    [350, 20, 10],
    [0, 0, 0],
  ])('magnetic %d with declination %d is %d', (magnetic, declination, expected) => {
    expect(trueHeading(magnetic, declination)).toBeCloseTo(expected, 9)
  })

  test('always in [0, 360): 360 never', () => {
    const declinations = [-180, -16, -0.0001, 0, 0.0001, 16, 180]
    for (let magnetic = 0; magnetic < 360; magnetic += 0.5) {
      for (const declination of declinations) {
        const result = trueHeading(magnetic, declination)
        expect(result).toBeGreaterThanOrEqual(0)
        expect(result).toBeLessThan(360)
      }
    }
    expect(trueHeading(344, 16)).toBe(0)
    expect(trueHeading(-1e-14, 0)).toBe(0)
  })
})

describe('headingDelta', () => {
  test('the shortest way round', () => {
    expect(headingDelta(359.5, 0.2)).toBeCloseTo(0.7, 9)
    expect(headingDelta(0.2, 359.5)).toBeCloseTo(0.7, 9)
    expect(headingDelta(10, 350)).toBe(20)
    expect(headingDelta(0, 180)).toBe(180)
    expect(headingDelta(228, 228)).toBe(0)
  })
})
