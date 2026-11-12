import { expect, test } from 'vitest'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import { formatDayMonth, formatDayMonthTime, fromLocalInputValue, toLocalInputValue } from './dateTime'

// Every date is built with the local Date constructor, so the expectations hold in any time
// zone the tests run in.

function localInstant(...parts: [number, number, number, number, number]): HistoryInstant {
  const instant = toHistoryInstant(new Date(...parts).toISOString())
  if (instant === null) throw new Error('not an instant')
  return instant
}

test('toLocalInputValue gives YYYY-MM-DDTHH:mm in local time, zero-padded', () => {
  expect(toLocalInputValue(new Date(2026, 10, 12, 15, 30))).toBe('2026-11-12T15:30')
  expect(toLocalInputValue(new Date(2026, 0, 5, 7, 4, 59))).toBe('2026-01-05T07:04')
})

test('fromLocalInputValue reads the value as local time', () => {
  expect(fromLocalInputValue('2026-11-12T15:30')).toBe(localInstant(2026, 10, 12, 15, 30))
})

test('round trip: a local date to the input value and back to the same instant', () => {
  const date = new Date(2026, 1, 28, 23, 59)
  expect(fromLocalInputValue(toLocalInputValue(date))).toBe(localInstant(2026, 1, 28, 23, 59))
})

test.each(['', 'abc', '2026-11-12', '2026-13-12T10:00', '2026-11-12T25:00', '2026-11-12T10:00Z', '2026-11-12T10:00-03:00'])(
  'fromLocalInputValue(%j) is null',
  (value) => {
    expect(fromLocalInputValue(value)).toBeNull()
  },
)

test('formatDayMonth gives DD/MM in local time', () => {
  expect(formatDayMonth(localInstant(2026, 10, 2, 0, 5))).toBe('02/11')
  expect(formatDayMonth(localInstant(2026, 11, 31, 23, 59))).toBe('31/12')
})

test('formatDayMonthTime gives DD/MM, HH:mm in local time', () => {
  expect(formatDayMonthTime(localInstant(2026, 10, 12, 15, 30))).toBe('12/11, 15:30')
  expect(formatDayMonthTime(localInstant(2026, 0, 3, 7, 4))).toBe('03/01, 07:04')
})

test('microseconds in an instant do not break the formats', () => {
  const base = localInstant(2026, 10, 12, 15, 30)
  const withMicros = toHistoryInstant(base.replace('.000000Z', '.123456Z'))
  if (withMicros === null) throw new Error('not an instant')

  expect(formatDayMonthTime(withMicros)).toBe('12/11, 15:30')
})
