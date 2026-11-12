import { describe, expect, test, vi } from 'vitest'
import type { BaitSiteEventType } from './baitSiteStateMachine'
import { toHistoryInstant, type HistoryInstant } from './historyOrder'
import { createLocalCommands, type NewBaitSite } from './localCommands'
import { mergeProject, type BaitSiteView } from './localMerge'
import type { LocalSession } from './localSession'
import type { LocalEvent } from './localStore'
import type { IdGenerator } from './ports'

const P = 'p-1'
const NOW = new Date('2026-11-12T15:30:00.123Z')

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

const day = (n: number): HistoryInstant => instant(`2026-11-${String(n).padStart(2, '0')}T10:00:00Z`)

function setup(submit: LocalSession['submit'] = async () => 'queued') {
  const spy = vi.fn<LocalSession['submit']>(submit)
  let count = 0
  const ids: IdGenerator = {
    newId: () => {
      count += 1
      return `id-${count}`
    },
  }
  return { submit: spy, commands: createLocalCommands({ submit: spy }, ids, () => NOW) }
}

/** A confirmed event of site s-1. */
function event(id: string, type: BaitSiteEventType, occurredAt: HistoryInstant, identifiedEventId: string | null = null): LocalEvent {
  return {
    id,
    projectId: P,
    baitSiteId: 's-1',
    type,
    occurredAt,
    speciesId: null,
    identifiedEventId,
    recordedAt: '2026-11-20T12:00:00Z',
  }
}

/** Site s-1 as the merge shows it, with these confirmed events. */
function siteWith(...events: LocalEvent[]): BaitSiteView {
  const [site] = mergeProject({
    project: null,
    baitSites: [
      { id: 's-1', projectId: P, name: 'Ipe tree', latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' },
    ],
    events,
    species: [],
    queue: [],
  }).baitSites
  if (site === undefined) throw new Error('no bait site')
  return site
}

describe('createProject', () => {
  test('submits a createProject item with a new id and returns the outcome', async () => {
    const { submit, commands } = setup()

    await expect(commands.createProject('Farm')).resolves.toBe('queued')

    expect(submit).toHaveBeenCalledExactlyOnceWith({ kind: 'createProject', projectId: 'id-1', name: 'Farm' })
  })

  test('two calls submit two different ids', async () => {
    const { submit, commands } = setup()

    await commands.createProject('Farm')
    await commands.createProject('Farm')

    const ids = submit.mock.calls.map(([payload]) => payload.projectId)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  test("'notReady' is passed through", async () => {
    const { commands } = setup(async () => 'notReady')

    await expect(commands.createProject('Farm')).resolves.toBe('notReady')
  })

  test('a rejecting submit makes it reject', async () => {
    const failure = new Error('enqueue failed')
    const { commands } = setup(async () => {
      throw failure
    })

    await expect(commands.createProject('Farm')).rejects.toBe(failure)
  })

  test('the name is passed untouched', async () => {
    const { submit, commands } = setup()

    await commands.createProject('  x  ')

    expect(submit.mock.calls[0]?.[0]).toMatchObject({ name: '  x  ' })
  })
})

describe('createBaitSite', () => {
  const NEW_SITE: NewBaitSite = {
    projectId: P,
    name: 'Isca 3',
    latitude: -27.25,
    longitude: -49.75,
    locationAccuracyM: 8,
    occurredAt: null,
  }

  test('submits a createBaitSite item: site id first, then its INSTALLED; occurredAt null is now', async () => {
    const { submit, commands } = setup()

    await expect(commands.createBaitSite(NEW_SITE)).resolves.toBe('queued')

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      kind: 'createBaitSite',
      projectId: P,
      baitSiteId: 'id-1',
      name: 'Isca 3',
      latitude: -27.25,
      longitude: -49.75,
      locationAccuracyM: 8,
      installation: { id: 'id-2', occurredAt: instant('2026-11-12T15:30:00.123Z') },
    })
  })

  test('a given occurredAt passes unchanged; the name is untouched; a null accuracy stays null', async () => {
    const { submit, commands } = setup()

    await commands.createBaitSite({ ...NEW_SITE, name: '  x  ', locationAccuracyM: null, occurredAt: day(3) })

    expect(submit.mock.calls[0]?.[0]).toMatchObject({
      name: '  x  ',
      locationAccuracyM: null,
      installation: { id: 'id-2', occurredAt: day(3) },
    })
  })

  test("'notReady' is passed through", async () => {
    const { commands } = setup(async () => 'notReady')

    await expect(commands.createBaitSite(NEW_SITE)).resolves.toBe('notReady')
  })

  test('a rejecting submit makes it reject', async () => {
    const failure = new Error('enqueue failed')
    const { commands } = setup(async () => {
      throw failure
    })

    await expect(commands.createBaitSite(NEW_SITE)).rejects.toBe(failure)
  })
})

describe('recordEvent', () => {
  // INSTALLED t1, CAPTURED t3: the site is CAPTURED now.
  const captured = () => siteWith(event('e-1', 'INSTALLED', day(1)), event('e-3', 'CAPTURED', day(3)))

  test('a valid event: a recordEvent item with a new id, null species fields for its type; occurredAt null is now', async () => {
    const { submit, commands } = setup()

    await expect(commands.recordEvent(P, captured(), { type: 'INSPECTED', occurredAt: null })).resolves.toBe('queued')

    expect(submit).toHaveBeenCalledExactlyOnceWith({
      kind: 'recordEvent',
      projectId: P,
      baitSiteId: 's-1',
      eventId: 'id-1',
      type: 'INSPECTED',
      occurredAt: instant('2026-11-12T15:30:00.123Z'),
      speciesId: null,
      identifiedEventId: null,
    })
  })

  test('a CAPTURED carries its species and no identifiedEventId', async () => {
    const { submit, commands } = setup()
    const armed = siteWith(event('e-1', 'INSTALLED', day(1)))

    await commands.recordEvent(P, armed, { type: 'CAPTURED', speciesId: 'sp-1', occurredAt: day(2) })

    expect(submit.mock.calls[0]?.[0]).toMatchObject({ type: 'CAPTURED', occurredAt: day(2), speciesId: 'sp-1', identifiedEventId: null })
  })

  test('past-dated, invalid in its place but valid at the end: invalidSequence, nothing submitted', async () => {
    const { submit, commands } = setup()

    // In its place: INSTALLED, LOST (from ARMED). At the end it would follow the CAPTURED.
    await expect(commands.recordEvent(P, captured(), { type: 'LOST', occurredAt: day(2) })).resolves.toBe('invalidSequence')

    expect(submit).not.toHaveBeenCalled()
  })

  test('past-dated, valid in its place but invalid at the end: submitted', async () => {
    const { submit, commands } = setup()

    // In its place: INSTALLED, ACTIVITY, CAPTURED. At the end it would be ACTIVITY on CAPTURED.
    await expect(commands.recordEvent(P, captured(), { type: 'ACTIVITY', occurredAt: day(2) })).resolves.toBe('queued')

    expect(submit.mock.calls[0]?.[0]).toMatchObject({ kind: 'recordEvent', type: 'ACTIVITY', occurredAt: day(2) })
  })

  test('impossible now (ACTIVITY on a CAPTURED site): invalidSequence, nothing submitted', async () => {
    const { submit, commands } = setup()

    await expect(commands.recordEvent(P, captured(), { type: 'ACTIVITY', occurredAt: null })).resolves.toBe('invalidSequence')

    expect(submit).not.toHaveBeenCalled()
  })

  test('an IDENTIFIED pointing to the capture is submitted with its species and target', async () => {
    const { submit, commands } = setup()

    await expect(
      commands.recordEvent(P, captured(), { type: 'IDENTIFIED', speciesId: 'sp-1', identifiedEventId: 'e-3', occurredAt: null }),
    ).resolves.toBe('queued')

    expect(submit.mock.calls[0]?.[0]).toMatchObject({ type: 'IDENTIFIED', speciesId: 'sp-1', identifiedEventId: 'e-3' })
  })

  test('two calls submit two different ids', async () => {
    const { submit, commands } = setup()

    await commands.recordEvent(P, captured(), { type: 'INSPECTED', occurredAt: null })
    await commands.recordEvent(P, captured(), { type: 'INSPECTED', occurredAt: null })

    const ids = submit.mock.calls.map(([payload]) => (payload.kind === 'recordEvent' ? payload.eventId : null))
    expect(ids).toEqual(['id-1', 'id-2'])
  })

  test('a rejecting submit makes it reject', async () => {
    const failure = new Error('enqueue failed')
    const { commands } = setup(async () => {
      throw failure
    })

    await expect(commands.recordEvent(P, captured(), { type: 'INSPECTED', occurredAt: null })).rejects.toBe(failure)
  })
})

describe('voidEvent', () => {
  test('voiding a plain event submits a voidEvent item', async () => {
    const { submit, commands } = setup()
    const site = siteWith(event('e-1', 'INSTALLED', day(1)), event('e-2', 'ACTIVITY', day(2)))

    await expect(commands.voidEvent(P, site, 'e-2')).resolves.toBe('queued')

    expect(submit).toHaveBeenCalledExactlyOnceWith({ kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-2' })
  })

  test('a capture with an IDENTIFIED pointing to it: invalidSequence; voiding the IDENTIFIED first is submitted', async () => {
    const { submit, commands } = setup()
    const site = siteWith(
      event('e-1', 'INSTALLED', day(1)),
      event('e-2', 'CAPTURED', day(2)),
      event('e-3', 'IDENTIFIED', day(3), 'e-2'),
    )

    await expect(commands.voidEvent(P, site, 'e-2')).resolves.toBe('invalidSequence')
    expect(submit).not.toHaveBeenCalled()

    await expect(commands.voidEvent(P, site, 'e-3')).resolves.toBe('queued')
    expect(submit).toHaveBeenCalledExactlyOnceWith({ kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-3' })
  })

  test('voiding the only event of a site (its INSTALLED) is valid: the history becomes EMPTY', async () => {
    const { submit, commands } = setup()

    await expect(commands.voidEvent(P, siteWith(event('e-1', 'INSTALLED', day(1))), 'e-1')).resolves.toBe('queued')

    expect(submit).toHaveBeenCalledOnce()
  })

  test('voiding the INSTALLED while later events remain: invalidSequence', async () => {
    const { submit, commands } = setup()
    const site = siteWith(event('e-1', 'INSTALLED', day(1)), event('e-2', 'ACTIVITY', day(2)))

    await expect(commands.voidEvent(P, site, 'e-1')).resolves.toBe('invalidSequence')

    expect(submit).not.toHaveBeenCalled()
  })

  test('an eventId not in the site rejects (a programming error) and submits nothing', async () => {
    const { submit, commands } = setup()

    await expect(commands.voidEvent(P, siteWith(event('e-1', 'INSTALLED', day(1))), 'e-9')).rejects.toThrow(
      'The event to void is not in the history of this bait site.',
    )

    expect(submit).not.toHaveBeenCalled()
  })

  test('a rejecting submit makes it reject', async () => {
    const failure = new Error('enqueue failed')
    const { commands } = setup(async () => {
      throw failure
    })

    await expect(commands.voidEvent(P, siteWith(event('e-1', 'INSTALLED', day(1))), 'e-1')).rejects.toBe(failure)
  })
})
