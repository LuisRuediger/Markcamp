/**
 * History order on the device: `(occurred_at, id)`, compared exactly as Postgres does
 * (ADR 0007, derived rule 8). If the device ordered two events differently from the
 * server, it would replay a different history and show a different status.
 *
 * Why the instants are normalized first:
 * - The raw strings from the server cannot be compared as text. Jackson writes an Instant
 *   with 0, 3 or 6 fraction digits, and "...10:00:00Z" sorts after "...10:00:00.500Z"
 *   because "Z" > ".". Input typed on the device may also carry an offset ("-03:00").
 * - Date cannot be used: it keeps milliseconds, Postgres keeps microseconds. Two events
 *   1 µs apart would tie on the device and be ordered by id, but by time on the server.
 *
 * A HistoryInstant is a fixed-width UTC string, `YYYY-MM-DDTHH:MM:SS.ffffffZ`. It sorts
 * correctly as plain text, keeps microseconds, and can be an IndexedDB index key.
 */
export type HistoryInstant = string & { readonly __brand: 'HistoryInstant' }

export interface HistoryOrderKey {
  readonly occurredAt: HistoryInstant
  readonly id: string
}

// Uppercase T and Z only, seconds required, 1 to 6 fraction digits, offset required.
// \d matches ASCII digits only in JavaScript (never other Unicode digits).
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|([+-])(\d{2}):(\d{2}))$/

const MIN_YEAR = 1000
const MAX_YEAR = 9999
const MAX_OFFSET_MINUTES = 18 * 60
const MS_PER_MINUTE = 60_000

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31
}

/**
 * Parses an instant into its normalized form, or returns null if it is not a well-formed
 * instant. It does not apply business rules: the accepted window for occurred_at
 * (ADR 0005, rule 2) is checked by the server only.
 */
export function toHistoryInstant(value: string): HistoryInstant | null {
  const match = INSTANT.exec(value)
  if (match === null) return null
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction, sign, offsetHourText, offsetMinuteText] =
    match

  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (year < MIN_YEAR || year > MAX_YEAR) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  // No leap second (60): Postgres and Java do not accept it either.
  if (hour > 23 || minute > 59 || second > 59) return null

  let offsetMinutes = 0
  if (sign !== undefined) {
    const offsetHour = Number(offsetHourText)
    const offsetMinute = Number(offsetMinuteText)
    if (offsetMinute > 59) return null
    offsetMinutes = offsetHour * 60 + offsetMinute
    if (offsetMinutes > MAX_OFFSET_MINUTES) return null
    if (sign === '-') offsetMinutes = -offsetMinutes
  }

  // Whole seconds only go through Date; the fraction never does, so no microsecond is lost.
  // Safe here: Date.UTC maps years 0-99 to 1900-1999, and the year is at least 1000.
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * MS_PER_MINUTE)
  const utcYear = utc.getUTCFullYear()
  // Checked again after the offset, so the output stays fixed-width.
  if (utcYear < MIN_YEAR || utcYear > MAX_YEAR) return null

  // toISOString gives "YYYY-MM-DDTHH:MM:SS.mmmZ" for years 0-9999; keep up to the seconds.
  const wholeSeconds = utc.toISOString().slice(0, 19)
  // Right-padded, never rounded: ".5" is half a second, ".500000".
  const micros = (fraction ?? '').padEnd(6, '0')
  // The only cast in this code: the brand marks the string as normalized.
  return `${wholeSeconds}.${micros}Z` as HistoryInstant
}

/**
 * By occurredAt, then by id. Both are compared as plain strings (UTF-16 code units), never
 * with localeCompare. For ids this matches Postgres because every id on the device is a
 * canonical lowercase UUID, whose text order is the order of its unsigned bytes.
 */
export function compareHistoryOrder(a: HistoryOrderKey, b: HistoryOrderKey): number {
  if (a.occurredAt < b.occurredAt) return -1
  if (a.occurredAt > b.occurredAt) return 1
  if (a.id < b.id) return -1
  if (a.id > b.id) return 1
  return 0
}

/** Returns a new array in history order; the input is not changed. */
export function sortIntoHistoryOrder<T extends HistoryOrderKey>(events: readonly T[]): T[] {
  return events.toSorted(compareHistoryOrder)
}
