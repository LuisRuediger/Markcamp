import { describe, expect, test } from 'vitest'
import type { BaitSiteEventType } from './baitSiteStateMachine'
import {
  allowedEventTypes,
  checkNewEvent,
  checkVoid,
  hasPendingChanges,
  identificationTarget,
  suggestBaitSiteName,
} from './baitSiteRules'
import { toHistoryInstant, type HistoryInstant } from './historyOrder'
import { mergeProject, type BaitSiteView } from './localMerge'
import type { LocalEvent, QueueItem } from './localStore'

const P = 'p-1'

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

const day = (n: number): HistoryInstant => instant(`2026-11-${String(n).padStart(2, '0')}T10:00:00Z`)

function event(id: string, type: BaitSiteEventType, occurredAt: HistoryInstant): LocalEvent {
  return {
    id,
    projectId: P,
    baitSiteId: 's-1',
    type,
    occurredAt,
    speciesId: null,
    identifiedEventId: null,
    recordedAt: '2026-11-20T12:00:00Z',
  }
}

/** Site s-1 as the merge shows it: these confirmed events, and these queue items. */
function siteWith(events: readonly LocalEvent[], queue: readonly QueueItem[] = []): BaitSiteView {
  const [site] = mergeProject({
    project: null,
    baitSites: [
      { id: 's-1', projectId: P, name: 'Ipe tree', latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' },
    ],
    events,
    species: [],
    queue,
  }).baitSites
  if (site === undefined) throw new Error('no bait site')
  return site
}

describe('suggestBaitSiteName', () => {
  test.each<[string, readonly string[], string]>([
    ['no names', [], 'Isca 1'],
    ['highest + 1, not count + 1', ['Isca 1', 'Isca 5'], 'Isca 6'],
    ['other names do not count', ['Árvore', 'Isca 2'], 'Isca 3'],
    ['lowercase is ignored', ['isca 7'], 'Isca 1'],
    ['a suffix is ignored', ['Isca 7a'], 'Isca 1'],
    ['two spaces are ignored', ['Isca  7'], 'Isca 1'],
    ['a full-width digit is ignored', ['Isca ７'], 'Isca 1'],
    ['a leading space is ignored', [' Isca 7'], 'Isca 1'],
    ['"Isca 0" counts as 0', ['Isca 0'], 'Isca 1'],
    ['nine digits count', ['Isca 999999999'], 'Isca 1000000000'],
    ['a 10-digit number is ignored', ['Isca 1234567890', 'Isca 4'], 'Isca 5'],
    ['leading zeros read as the number', ['Isca 007'], 'Isca 8'],
  ])('%s', (_name, names, expected) => {
    expect(suggestBaitSiteName(names)).toBe(expected)
  })
})

describe('hasPendingChanges', () => {
  const installed = event('e-1', 'INSTALLED', day(1))
  const activity = event('e-2', 'ACTIVITY', day(2))
  const queued = (seq: number, payload: QueueItem['payload']): QueueItem => ({ seq, payload, rejection: null })

  test.each<[string, BaitSiteView, boolean]>([
    [
      'the site itself is pending',
      siteWith(
        [],
        [
          queued(1, {
            kind: 'createBaitSite',
            projectId: P,
            baitSiteId: 's-1',
            name: 'Ipe tree',
            latitude: -27.1,
            longitude: -49.1,
            locationAccuracyM: 5,
            installation: { id: 'e-1', occurredAt: day(1) },
          }),
        ],
      ),
      true,
    ],
    [
      'a confirmed site with a pending event',
      siteWith(
        [installed],
        [
          queued(1, {
            kind: 'recordEvent',
            projectId: P,
            baitSiteId: 's-1',
            eventId: 'e-2',
            type: 'ACTIVITY',
            occurredAt: day(2),
            speciesId: null,
            identifiedEventId: null,
          }),
        ],
      ),
      true,
    ],
    [
      'a confirmed site with a pending void',
      siteWith([installed, activity], [queued(1, { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-2' })]),
      true,
    ],
    ['everything confirmed', siteWith([installed, activity]), false],
  ])('%s', (_name, site, expected) => {
    expect(hasPendingChanges(site)).toBe(expected)
  })

  test('the cases above are what they claim', () => {
    // Guards the table: the void case hides its event, so only pendingVoidEventIds shows it.
    const voided = siteWith([installed, activity], [queued(1, { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-2' })])
    expect(voided.pending).toBe(false)
    expect(voided.events.some((candidate) => candidate.pending)).toBe(false)
  })
})

describe('identificationTarget', () => {
  test('null when the site has no capture', () => {
    expect(identificationTarget(siteWith([event('e-1', 'INSTALLED', day(1))]))).toBeNull()
  })

  test('the latest of two captures by history order, not by array position', () => {
    const site = siteWith([
      event('e-1', 'INSTALLED', day(1)),
      event('e-2', 'CAPTURED', day(2)),
      event('e-3', 'LOST', day(3)),
      event('e-4', 'CAPTURED', day(4)),
    ])

    expect(identificationTarget(site)?.id).toBe('e-4')
    // The same events in reverse array order: still the one later in history.
    expect(identificationTarget({ ...site, events: site.events.toReversed() })?.id).toBe('e-4')
  })
})

describe('allowedEventTypes (ADR 0005, "Allowed when the status is")', () => {
  const installed = event('e-1', 'INSTALLED', day(1))
  const captured = event('e-3', 'CAPTURED', day(3))
  const voidOfInstalled: QueueItem = { seq: 1, payload: { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-1' }, rejection: null }

  test.each<[string, BaitSiteView, readonly BaitSiteEventType[]]>([
    ['EMPTY after every event was voided', siteWith([installed], [voidOfInstalled]), ['INSTALLED']],
    ['ARMED', siteWith([installed]), ['ACTIVITY', 'CAPTURED', 'REMOVED', 'INSPECTED']],
    ['ACTIVE', siteWith([installed, event('e-2', 'ACTIVITY', day(2))]), ['ACTIVITY', 'CAPTURED', 'REMOVED', 'INSPECTED']],
    ['CAPTURED', siteWith([installed, captured]), ['LOST', 'COLLECTED', 'INSPECTED', 'IDENTIFIED']],
    [
      'LOST',
      siteWith([installed, captured, event('e-4', 'LOST', day(4))]),
      ['INSTALLED', 'CAPTURED', 'REMOVED', 'INSPECTED', 'IDENTIFIED'],
    ],
    // IDENTIFIED is allowed from any status once there is a capture to point to.
    ['EMPTY after a collected capture', siteWith([installed, captured, event('e-4', 'COLLECTED', day(4))]), ['INSTALLED', 'IDENTIFIED']],
  ])('%s', (_name, site, expected) => {
    expect(site.replay.valid).toBe(true)
    expect(allowedEventTypes(site)).toEqual(expected)
  })

  test('IDENTIFIED is never offered without a capture', () => {
    for (const site of [siteWith([installed]), siteWith([installed, event('e-2', 'REMOVED', day(2))])]) {
      expect(allowedEventTypes(site)).not.toContain('IDENTIFIED')
    }
  })

  test('empty when the history does not replay', () => {
    const invalid = siteWith([installed, event('e-2', 'LOST', day(2))])

    expect(invalid.replay.valid).toBe(false)
    expect(allowedEventTypes(invalid)).toEqual([])
  })
})

describe('checkNewEvent and checkVoid', () => {
  const site = siteWith([event('e-1', 'INSTALLED', day(1)), event('e-3', 'CAPTURED', day(3))])

  test('checkNewEvent places the event by history order', () => {
    expect(checkNewEvent(site, { id: 'n', type: 'ACTIVITY', identifiedEventId: null, occurredAt: day(2) })).toBe('ok')
    expect(checkNewEvent(site, { id: 'n', type: 'ACTIVITY', identifiedEventId: null, occurredAt: day(4) })).toBe('invalidSequence')
  })

  test("checkVoid: 'ok', 'invalidSequence' and 'notFound'", () => {
    expect(checkVoid(site, 'e-3')).toBe('ok')
    expect(checkVoid(site, 'e-1')).toBe('invalidSequence')
    expect(checkVoid(site, 'e-9')).toBe('notFound')
  })
})
