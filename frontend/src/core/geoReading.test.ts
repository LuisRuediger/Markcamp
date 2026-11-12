import { describe, expect, test } from 'vitest'
import { betterReading, isUsableReading } from './geoReading'
import type { GeoReading } from './ports'

function reading(accuracyM: number, latitude = -27.1, longitude = -49.1): GeoReading {
  return { latitude, longitude, accuracyM }
}

describe('isUsableReading', () => {
  test.each<[string, GeoReading, boolean]>([
    ['a normal reading', reading(8), true],
    ['the coordinate limits', reading(8, -90, 180), true],
    ['the other limits', reading(8, 90, -180), true],
    ['a fraction of a metre', reading(0.5), true],
    ['accuracy 0', reading(0), false],
    ['negative accuracy', reading(-5), false],
    ['NaN accuracy', reading(Number.NaN), false],
    ['Infinity accuracy', reading(Number.POSITIVE_INFINITY), false],
    ['latitude 91', reading(8, 91), false],
    ['latitude -91', reading(8, -91), false],
    ['longitude -181', reading(8, -27.1, -181), false],
    ['longitude 181', reading(8, -27.1, 181), false],
    ['NaN latitude', reading(8, Number.NaN), false],
    ['NaN longitude', reading(8, -27.1, Number.NaN), false],
    ['Infinity latitude', reading(8, Number.POSITIVE_INFINITY), false],
  ])('%s', (_name, input, expected) => {
    expect(isUsableReading(input)).toBe(expected)
  })
})

describe('betterReading', () => {
  const eight = reading(8)
  const fifteen = reading(15, -27.2, -49.2)

  test.each<[string, GeoReading | null, GeoReading, GeoReading | null]>([
    ['the first usable reading', null, eight, eight],
    ['a smaller accuracy wins', fifteen, eight, eight],
    ['a worse reading keeps the best', eight, fifteen, eight],
    ['a tie keeps best', eight, reading(8, -27.3, -49.3), eight],
    ['an unusable next keeps best', eight, reading(0), eight],
    ['an unusable next with best null gives null', null, reading(Number.NaN), null],
    ['an unusable next is refused even when it looks better', fifteen, reading(1, 95), fifteen],
  ])('%s', (_name, best, next, expected) => {
    expect(betterReading(best, next)).toBe(expected)
  })
})
