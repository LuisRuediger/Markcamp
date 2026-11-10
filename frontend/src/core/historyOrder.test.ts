import { describe, expect, test } from 'vitest'
import { compareHistoryOrder, sortIntoHistoryOrder, toHistoryInstant } from './historyOrder'
import type { HistoryOrderKey } from './historyOrder'

function key(occurredAt: string, id: string): HistoryOrderKey {
  const instant = toHistoryInstant(occurredAt)
  if (instant === null) throw new Error(`not an instant: ${occurredAt}`)
  return { occurredAt: instant, id }
}

describe('toHistoryInstant normalizes', () => {
  test.each([
    ['no fraction', '2026-11-07T10:00:00Z', '2026-11-07T10:00:00.000000Z'],
    ['a negative offset', '2026-11-07T07:00:00-03:00', '2026-11-07T10:00:00.000000Z'],
    ['one fraction digit, right-padded', '2026-11-07T10:00:00.5Z', '2026-11-07T10:00:00.500000Z'],
    ['three fraction digits', '2026-11-07T10:00:00.123Z', '2026-11-07T10:00:00.123000Z'],
    ['six fraction digits, kept', '2026-11-07T10:00:00.123456Z', '2026-11-07T10:00:00.123456Z'],
    ['an offset that crosses day, month and year', '2026-01-01T01:00:00+03:00', '2025-12-31T22:00:00.000000Z'],
    ['February 29 of a leap year', '2028-02-29T12:00:00Z', '2028-02-29T12:00:00.000000Z'],
    ['the maximum offset', '2026-11-07T18:00:00+18:00', '2026-11-07T00:00:00.000000Z'],
  ])('%s', (_, input, expected) => {
    expect(toHistoryInstant(input)).toBe(expected)
  })
})

describe('toHistoryInstant rejects', () => {
  test.each([
    ['February 29 of a common year', '2026-02-29T10:00:00Z'],
    ['month 13', '2026-13-01T10:00:00Z'],
    ['month 0', '2026-00-01T10:00:00Z'],
    ['day 32', '2026-01-32T10:00:00Z'],
    ['day 31 of a 30-day month', '2026-04-31T10:00:00Z'],
    ['hour 24', '2026-11-07T24:00:00Z'],
    ['minute 60', '2026-11-07T10:60:00Z'],
    ['second 60', '2026-11-07T10:00:60Z'],
    ['offset +19:00', '2026-11-07T10:00:00+19:00'],
    ['offset +18:01', '2026-11-07T10:00:00+18:01'],
    ['offset minutes 60', '2026-11-07T10:00:00+03:60'],
    ['no offset', '2026-11-07T10:00:00'],
    ['no seconds', '2026-11-07T10:00Z'],
    ['seven fraction digits', '2026-11-07T10:00:00.1234567Z'],
    ['a dot with no digits', '2026-11-07T10:00:00.Z'],
    ['lowercase t', '2026-11-07t10:00:00Z'],
    ['lowercase z', '2026-11-07T10:00:00z'],
    ['a leading space', ' 2026-11-07T10:00:00Z'],
    ['a trailing space', '2026-11-07T10:00:00Z '],
    ['year 0999', '0999-12-31T10:00:00Z'],
    ['an offset that pulls year 1000 back to 999', '1000-01-01T00:30:00+01:00'],
    ['an offset that pushes year 9999 past 9999', '9999-12-31T23:00:00-03:00'],
    ['the empty string', ''],
  ])('%s', (_, input) => {
    expect(toHistoryInstant(input)).toBeNull()
  })
})

describe('history order', () => {
  test('no fraction comes before .500 on the same second', () => {
    // As raw strings the order is the opposite: "...10:00:00Z" > "...10:00:00.500Z", because "Z" > ".".
    const whole = key('2026-11-07T10:00:00Z', 'b')
    const half = key('2026-11-07T10:00:00.500Z', 'a')

    expect(compareHistoryOrder(whole, half)).toBeLessThan(0)
  })

  test('.5 comes before .500001: the fraction is padded, not kept as written', () => {
    // Unpadded, ".5Z" > ".500001Z" because "Z" > "0".
    const half = key('2026-11-07T10:00:00.5Z', 'b')
    const later = key('2026-11-07T10:00:00.500001Z', 'a')

    expect(compareHistoryOrder(half, later)).toBeLessThan(0)
  })

  test('one microsecond apart is ordered by time, not by id', () => {
    // The lower id is the later event, so a millisecond-only instant would put it first.
    const earlier = key('2026-11-07T10:00:00.123456Z', 'b')
    const later = key('2026-11-07T10:00:00.123457Z', 'a')

    expect(compareHistoryOrder(earlier, later)).toBeLessThan(0)
    expect(sortIntoHistoryOrder([later, earlier])).toEqual([earlier, later])
  })

  test('the same instant written with two offsets is a tie broken by id', () => {
    const utc = key('2026-11-07T10:00:00Z', 'b')
    const local = key('2026-11-07T07:00:00-03:00', 'a')

    expect(utc.occurredAt).toBe(local.occurredAt)
    expect(compareHistoryOrder(local, utc)).toBeLessThan(0)
  })

  test('equal occurredAt: the lower id comes first', () => {
    const lower = key('2026-11-07T10:00:00Z', '01900000-0000-7000-8000-00000000000a')
    const higher = key('2026-11-07T10:00:00Z', '01900000-0000-7000-8000-00000000000b')

    expect(compareHistoryOrder(lower, higher)).toBeLessThan(0)
    expect(compareHistoryOrder(higher, lower)).toBeGreaterThan(0)
    expect(sortIntoHistoryOrder([higher, lower])).toEqual([lower, higher])
  })

  test('the same occurredAt and id compare equal', () => {
    expect(compareHistoryOrder(key('2026-11-07T10:00:00Z', 'a'), key('2026-11-07T10:00:00Z', 'a'))).toBe(0)
  })

  test('sortIntoHistoryOrder returns a new array and leaves its input alone', () => {
    const second = key('2026-11-07T11:00:00Z', 'a')
    const first = key('2026-11-07T10:00:00Z', 'b')
    const input = [second, first]

    const sorted = sortIntoHistoryOrder(input)

    expect(sorted).toEqual([first, second])
    expect(sorted).not.toBe(input)
    expect(input).toEqual([second, first])
  })
})
