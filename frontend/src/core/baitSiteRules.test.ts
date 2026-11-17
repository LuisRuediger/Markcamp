import { describe, expect, test } from 'vitest'
import type { BaitSiteEventType } from './baitSiteStateMachine'
import {
  checkNewEvent,
  checkVoid,
  effectiveSpeciesId,
  hasPendingChanges,
  isIdentified,
  recordableEventTypes,
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

function captured(id: string, occurredAt: HistoryInstant, speciesId: string | null): LocalEvent {
  return { ...event(id, 'CAPTURED', occurredAt), speciesId }
}

function identified(id: string, captureId: string, speciesId: string, occurredAt: HistoryInstant): LocalEvent {
  return { ...event(id, 'IDENTIFIED', occurredAt), speciesId, identifiedEventId: captureId }
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

describe('effectiveSpeciesId (ADR 0005, derived rule 4)', () => {
  const installed = event('e-1', 'INSTALLED', day(1))

  /** The capture with this id, as the merge shows it. */
  function captureOf(site: BaitSiteView, id: string) {
    const found = site.events.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`no event ${id}`)
    return found
  }

  test('a capture without species and no identification: null', () => {
    const site = siteWith([installed, captured('e-2', day(2), null)])

    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBeNull()
  })

  test('a capture with its own species and no identification: its own', () => {
    const site = siteWith([installed, captured('e-2', day(2), 'sp-own')])

    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBe('sp-own')
  })

  test('one identification: its species, over the capture own', () => {
    const site = siteWith([installed, captured('e-2', day(2), 'sp-own'), identified('e-3', 'e-2', 'sp-a', day(3))])

    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBe('sp-a')
  })

  test('two identifications of the same capture: the later by history order, not by array position', () => {
    const site = siteWith([
      installed,
      captured('e-2', day(2), null),
      identified('e-3', 'e-2', 'sp-early', day(3)),
      identified('e-4', 'e-2', 'sp-late', day(4)),
    ])
    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBe('sp-late')

    // The same events in reverse array order: the later identification comes first.
    const reversed: BaitSiteView = { ...site, events: site.events.toReversed() }
    expect(reversed.events.findIndex((candidate) => candidate.id === 'e-4')).toBeLessThan(
      reversed.events.findIndex((candidate) => candidate.id === 'e-3'),
    )
    expect(effectiveSpeciesId(reversed, captureOf(reversed, 'e-2'))).toBe('sp-late')
  })

  test('the same occurredAt: the id decides, like the history order', () => {
    const site = siteWith([
      installed,
      captured('e-2', day(2), null),
      identified('e-4', 'e-2', 'sp-by-id', day(3)),
      identified('e-3', 'e-2', 'sp-other', day(3)),
    ])

    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBe('sp-by-id')
    expect(effectiveSpeciesId({ ...site, events: site.events.toReversed() }, captureOf(site, 'e-2'))).toBe('sp-by-id')
  })

  test('an identification of another capture does not count', () => {
    const site = siteWith([
      installed,
      captured('e-2', day(2), 'sp-first'),
      event('e-3', 'LOST', day(3)),
      captured('e-4', day(4), null),
      identified('e-5', 'e-2', 'sp-a', day(5)),
    ])

    expect(effectiveSpeciesId(site, captureOf(site, 'e-4'))).toBeNull()
    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBe('sp-a')
  })

  test('a voided identification (pending void) does not count: the capture own is back', () => {
    const site = siteWith(
      [installed, captured('e-2', day(2), 'sp-own'), identified('e-3', 'e-2', 'sp-a', day(3))],
      [{ seq: 1, payload: { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-3' }, rejection: null }],
    )

    expect(effectiveSpeciesId(site, captureOf(site, 'e-2'))).toBe('sp-own')
  })

  test('a non-CAPTURED event: its own speciesId', () => {
    const site = siteWith([installed, captured('e-2', day(2), null), identified('e-3', 'e-2', 'sp-a', day(3))])

    expect(effectiveSpeciesId(site, captureOf(site, 'e-1'))).toBeNull()
    expect(effectiveSpeciesId(site, captureOf(site, 'e-3'))).toBe('sp-a')
    // Even an IDENTIFIED pointing to it (impossible in a valid history) is not followed.
    const odd = siteWith([installed, identified('e-9', 'e-1', 'sp-x', day(2))])
    expect(effectiveSpeciesId(odd, captureOf(odd, 'e-1'))).toBeNull()
  })
})

describe('isIdentified (decision N1-b of slice F3-3b)', () => {
  const installed = event('e-1', 'INSTALLED', day(1))

  /** The event with this id, as the merge shows it. */
  function eventOf(site: BaitSiteView, id: string) {
    const found = site.events.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`no event ${id}`)
    return found
  }

  test('no identification: false', () => {
    const site = siteWith([installed, captured('e-2', day(2), 'sp-own')])

    expect(isIdentified(site, eventOf(site, 'e-2'))).toBe(false)
  })

  test('one identification: true', () => {
    const site = siteWith([installed, captured('e-2', day(2), null), identified('e-3', 'e-2', 'sp-a', day(3))])

    expect(isIdentified(site, eventOf(site, 'e-2'))).toBe(true)
  })

  test('an identification of another capture: false for this one', () => {
    const site = siteWith([
      installed,
      captured('e-2', day(2), null),
      event('e-3', 'LOST', day(3)),
      captured('e-4', day(4), null),
      identified('e-5', 'e-2', 'sp-a', day(5)),
    ])

    expect(isIdentified(site, eventOf(site, 'e-4'))).toBe(false)
    expect(isIdentified(site, eventOf(site, 'e-2'))).toBe(true)
  })

  test('a pending identification: true', () => {
    const site = siteWith(
      [installed, captured('e-2', day(2), null)],
      [
        {
          seq: 1,
          payload: {
            kind: 'recordEvent',
            projectId: P,
            baitSiteId: 's-1',
            eventId: 'e-3',
            type: 'IDENTIFIED',
            occurredAt: day(3),
            speciesId: 'sp-a',
            identifiedEventId: 'e-2',
          },
          rejection: null,
        },
      ],
    )
    // Guards the case: the identification is in the view, and only as pending.
    expect(eventOf(site, 'e-3').pending).toBe(true)

    expect(isIdentified(site, eventOf(site, 'e-2'))).toBe(true)
  })

  test('the identification with a pending void: false', () => {
    const site = siteWith(
      [installed, captured('e-2', day(2), null), identified('e-3', 'e-2', 'sp-a', day(3))],
      [{ seq: 1, payload: { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-3' }, rejection: null }],
    )

    expect(isIdentified(site, eventOf(site, 'e-2'))).toBe(false)
  })
})

describe('recordableEventTypes (ADR 0005, "Allowed when the status is", without IDENTIFIED)', () => {
  const installed = event('e-1', 'INSTALLED', day(1))
  const capture = event('e-3', 'CAPTURED', day(3))
  const voidOfInstalled: QueueItem = { seq: 1, payload: { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-1' }, rejection: null }

  test.each<[string, BaitSiteView, readonly BaitSiteEventType[]]>([
    ['EMPTY after every event was voided', siteWith([installed], [voidOfInstalled]), ['INSTALLED']],
    ['ARMED', siteWith([installed]), ['ACTIVITY', 'CAPTURED', 'REMOVED', 'INSPECTED']],
    ['ACTIVE', siteWith([installed, event('e-2', 'ACTIVITY', day(2))]), ['ACTIVITY', 'CAPTURED', 'REMOVED', 'INSPECTED']],
    ['CAPTURED', siteWith([installed, capture]), ['LOST', 'COLLECTED', 'INSPECTED']],
    ['LOST', siteWith([installed, capture, event('e-4', 'LOST', day(4))]), ['INSTALLED', 'CAPTURED', 'REMOVED', 'INSPECTED']],
    ['EMPTY after a collected capture', siteWith([installed, capture, event('e-4', 'COLLECTED', day(4))]), ['INSTALLED']],
    ['EMPTY after a removal', siteWith([installed, event('e-2', 'REMOVED', day(2))]), ['INSTALLED']],
    [
      'ARMED again, with an identified capture in an earlier cycle',
      siteWith([installed, capture, identified('e-4', 'e-3', 'sp-a', day(4)), event('e-5', 'COLLECTED', day(5)), event('e-6', 'INSTALLED', day(6))]),
      ['ACTIVITY', 'CAPTURED', 'REMOVED', 'INSPECTED'],
    ],
  ])('%s', (_name, site, expected) => {
    expect(site.replay.valid).toBe(true)
    expect(recordableEventTypes(site)).toEqual(expected)
  })

  test('never IDENTIFIED, with or without a capture to point to', () => {
    const sites = [
      siteWith([installed]),
      siteWith([installed, capture]),
      siteWith([installed, capture, event('e-4', 'LOST', day(4))]),
      siteWith([installed, capture, event('e-4', 'COLLECTED', day(4))]),
    ]
    for (const site of sites) {
      expect(recordableEventTypes(site)).not.toContain('IDENTIFIED')
    }
  })

  test('empty when the history does not replay', () => {
    const invalid = siteWith([installed, event('e-2', 'LOST', day(2))])

    expect(invalid.replay.valid).toBe(false)
    expect(recordableEventTypes(invalid)).toEqual([])
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
