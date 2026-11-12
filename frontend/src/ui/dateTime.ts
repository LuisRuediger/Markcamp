import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'

// Dates as the person sees them: in the device's time zone. Here and not in core because they
// depend on that time zone (core has no clock and no locale; history instants are UTC).

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

// What a datetime-local input gives: a local date and time, no offset, seconds optional.
// A date alone ("2026-11-12") would be read as UTC midnight by Date, so it is refused.
const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/

/** `YYYY-MM-DDTHH:mm` in local time: the value (and max) of a datetime-local input. */
export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** A datetime-local value as a history instant; null for an empty or invalid value. */
export function fromLocalInputValue(value: string): HistoryInstant | null {
  if (!LOCAL_DATE_TIME.test(value)) return null
  // Without an offset, Date reads a date-time as local time.
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return toHistoryInstant(date.toISOString())
}

/**
 * A history instant as a Date. Cut to milliseconds first: `YYYY-MM-DDTHH:MM:SS.mmmZ` is the
 * one format every engine must parse; six fraction digits are not.
 */
function toDate(instant: HistoryInstant): Date {
  return new Date(`${instant.slice(0, 23)}Z`)
}

/** `DD/MM`, local. */
export function formatDayMonth(instant: HistoryInstant): string {
  const date = toDate(instant)
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`
}

/** `DD/MM, HH:mm`, local. */
export function formatDayMonthTime(instant: HistoryInstant): string {
  const date = toDate(instant)
  return `${formatDayMonth(instant)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
