// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it, test } from 'vitest'
import { BAIT_SITE_EVENT_TYPES, BAIT_SITE_STATUSES, replay } from '../src/core/baitSiteStateMachine'
import type { BaitSiteEventType, BaitSiteStatus, ReplayEvent, ReplayResult } from '../src/core/baitSiteStateMachine'

// shared/bait-site-state-machine-cases.json is the contract for every implementation of the
// state machine (ADR 0007, decision 3). The Java test runs the same file and also checks
// that it covers every cell of the transition table.
const CASES_FILE = new URL('../../shared/bait-site-state-machine-cases.json', import.meta.url)

interface ContractEvent {
  readonly type: BaitSiteEventType
  readonly label: string | null
  readonly identifies: string | null
}

interface ContractCase {
  readonly name: string
  readonly events: readonly ContractEvent[]
  readonly expected: ReplayResult
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEventType(value: unknown): value is BaitSiteEventType {
  return BAIT_SITE_EVENT_TYPES.some((type) => type === value)
}

function isStatus(value: unknown): value is BaitSiteStatus {
  return BAIT_SITE_STATUSES.some((status) => status === value)
}

function optionalString(value: unknown, field: string, where: string): string | null {
  if (value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${field} must be a string, in case: ${where}`)
  return value
}

/** Enforces the format of the file, like the Java test. A malformed case fails, never skips. */
function parseCase(raw: unknown, position: number): ContractCase {
  if (!isRecord(raw)) throw new Error(`case #${position} is not an object`)
  const name = raw['name']
  if (typeof name !== 'string') throw new Error(`case #${position} has no string name`)
  if (!Array.isArray(raw['events'])) throw new Error(`events must be an array, in case: ${name}`)
  const valid = raw['valid']
  if (typeof valid !== 'boolean') throw new Error(`valid must be a boolean, in case: ${name}`)
  const status = raw['status']
  const firstInvalidIndex = raw['firstInvalidIndex']

  let expected: ReplayResult
  if (valid) {
    if (!isStatus(status)) throw new Error(`a valid case needs a known status, in case: ${name}`)
    if (firstInvalidIndex !== undefined) throw new Error(`a valid case has no firstInvalidIndex, in case: ${name}`)
    expected = { valid: true, status }
  } else {
    if (typeof firstInvalidIndex !== 'number' || !Number.isInteger(firstInvalidIndex) || firstInvalidIndex < 0) {
      throw new Error(`an invalid case needs an integer firstInvalidIndex, in case: ${name}`)
    }
    if (status !== undefined) throw new Error(`an invalid case has no status, in case: ${name}`)
    expected = { valid: false, firstInvalidIndex }
  }

  const labels = new Set<string>()
  const events = raw['events'].map((event: unknown): ContractEvent => {
    if (!isRecord(event)) throw new Error(`an event is not an object, in case: ${name}`)
    const type = event['type']
    if (!isEventType(type)) throw new Error(`unknown event type ${String(type)}, in case: ${name}`)
    const label = optionalString(event['label'], 'label', name)
    const identifies = optionalString(event['identifies'], 'identifies', name)
    if (label !== null) {
      if (labels.has(label)) throw new Error(`label ${label} used twice, in case: ${name}`)
      labels.add(label)
    }
    if ((type === 'IDENTIFIED') !== (identifies !== null)) {
      throw new Error(`identifies goes on IDENTIFIED and only there, in case: ${name}`)
    }
    return { type, label, identifies }
  })

  return { name, events, expected }
}

function loadCases(): readonly ContractCase[] {
  const file: unknown = JSON.parse(readFileSync(CASES_FILE, 'utf8'))
  if (!isRecord(file) || !Array.isArray(file['cases'])) throw new Error('the file has no cases array')
  return file['cases'].map((raw: unknown, position: number) => parseCase(raw, position))
}

/**
 * The events as replay receives them. replay compares ids by equality only, so synthetic
 * ids are enough; the prefixes keep the three kinds from ever colliding.
 */
function toReplayEvents(events: readonly ContractEvent[]): ReplayEvent[] {
  // Labels first, because an IDENTIFIED may point to a capture later in the case.
  const labels = new Set(events.flatMap((event) => (event.label === null ? [] : [event.label])))
  return events.map((event, index) => ({
    id: event.label === null ? `event-${index}` : `label-${event.label}`,
    type: event.type,
    // A label that is not in the case gets an id no event has: a capture that is missing or voided.
    identifiedEventId:
      event.identifies === null
        ? null
        : labels.has(event.identifies)
          ? `label-${event.identifies}`
          : `missing-${event.identifies}`,
  }))
}

const cases = loadCases()

describe('bait site state machine contract', () => {
  it.each(cases)('$name', (testCase) => {
    expect(replay(toReplayEvents(testCase.events))).toEqual(testCase.expected)
  })
})

test('the file uses exactly the event types of BAIT_SITE_EVENT_TYPES', () => {
  const used = new Set(cases.flatMap((testCase) => testCase.events.map((event) => event.type)))

  expect([...used].sort()).toEqual([...BAIT_SITE_EVENT_TYPES].sort())
})

test('the valid cases end in exactly the statuses of BAIT_SITE_STATUSES', () => {
  const used = new Set(cases.flatMap((testCase) => (testCase.expected.valid ? [testCase.expected.status] : [])))

  expect([...used].sort()).toEqual([...BAIT_SITE_STATUSES].sort())
})
