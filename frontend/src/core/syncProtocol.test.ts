import { describe, expect, test } from 'vitest'
import type { ApiResult } from './apiClient'
import { createFakeLocalStore } from './fakeLocalStore'
import { toHistoryInstant } from './historyOrder'
import type { QueueItem, QueuePayload, QueueRejection } from './localStore'
import {
  classifyFollowUp,
  classifyResult,
  parseBaitSite,
  parseBaitSiteList,
  parseEvent,
  parseProjectEventList,
  parseSpecies,
  parseSpeciesList,
  sendableItems,
  type FollowUpAction,
  type ResultAction,
} from './syncProtocol'

const ok = (body: unknown = {}): ApiResult => ({ kind: 'ok', status: 200, body })
const problem = (status: number, code: string | null): ApiResult => ({ kind: 'apiError', status, code, fieldErrors: [] })
const defer: Extract<ResultAction, { kind: 'defer' }> = { kind: 'defer' }
const reject = (status: number, code: string | null): Extract<ResultAction, { kind: 'reject' }> => ({
  kind: 'reject',
  rejection: { status, code },
})

describe('classifyResult (E1)', () => {
  test.each<[string, ApiResult, ResultAction]>([
    ['ok', ok({ id: 'x' }), { kind: 'confirm', body: { id: 'x' } }],
    ['unavailable', { kind: 'unavailable' }, defer],
    ['unauthorized', { kind: 'unauthorized' }, defer],
    ['408', problem(408, 'INVALID_REQUEST'), defer],
    ['429', problem(429, null), defer],
    ['500', problem(500, 'INTERNAL_ERROR'), defer],
    ['502 without a code', problem(502, null), defer],
    ['503', problem(503, null), defer],
    ['409 ID_ALREADY_EXISTS', problem(409, 'ID_ALREADY_EXISTS'), { kind: 'lookUp' }],
    ['409 INVALID_EVENT_SEQUENCE', problem(409, 'INVALID_EVENT_SEQUENCE'), reject(409, 'INVALID_EVENT_SEQUENCE')],
    ['409 without a code', problem(409, null), reject(409, null)],
    ['409 with an unknown code', problem(409, 'SOMETHING_NEW'), reject(409, 'SOMETHING_NEW')],
    ['400 VALIDATION_FAILED', problem(400, 'VALIDATION_FAILED'), reject(400, 'VALIDATION_FAILED')],
    ['400 MALFORMED_REQUEST', problem(400, 'MALFORMED_REQUEST'), reject(400, 'MALFORMED_REQUEST')],
    ['403 FORBIDDEN', problem(403, 'FORBIDDEN'), reject(403, 'FORBIDDEN')],
    ['404 PROJECT_NOT_FOUND', problem(404, 'PROJECT_NOT_FOUND'), reject(404, 'PROJECT_NOT_FOUND')],
    ['404 BAIT_SITE_NOT_FOUND', problem(404, 'BAIT_SITE_NOT_FOUND'), reject(404, 'BAIT_SITE_NOT_FOUND')],
    ['415', problem(415, 'UNSUPPORTED_MEDIA_TYPE'), reject(415, 'UNSUPPORTED_MEDIA_TYPE')],
  ])('%s', (_, result, expected) => {
    expect(classifyResult(result)).toEqual(expected)
  })
})

describe('classifyFollowUp', () => {
  const notOurs: FollowUpAction = { kind: 'idNotOurs' }

  test.each<[string, ApiResult, boolean, FollowUpAction]>([
    ['ok', ok({ a: 1 }), true, { kind: 'confirm', body: { a: 1 } }],
    ['404 after ID_ALREADY_EXISTS', problem(404, 'BAIT_SITE_NOT_FOUND'), true, notOurs],
    ['404 without ID_ALREADY_EXISTS (any other 4xx)', problem(404, 'BAIT_SITE_EVENT_NOT_FOUND'), false, reject(404, 'BAIT_SITE_EVENT_NOT_FOUND')],
    ['500 defers', problem(500, 'INTERNAL_ERROR'), true, defer],
    ['unavailable defers', { kind: 'unavailable' }, true, defer],
    ['403 rejects', problem(403, 'FORBIDDEN'), true, reject(403, 'FORBIDDEN')],
    ['a 409 ID_ALREADY_EXISTS on a GET never asks for another look-up', problem(409, 'ID_ALREADY_EXISTS'), true, reject(409, 'ID_ALREADY_EXISTS')],
  ])('%s', (_, result, afterIdAlreadyExists, expected) => {
    expect(classifyFollowUp(result, afterIdAlreadyExists)).toEqual(expected)
  })
})

describe('sendableItems (E2)', () => {
  const at = toHistoryInstant('2026-11-01T10:00:00Z')!
  const REJECTION: QueueRejection = { status: 409, code: 'INVALID_EVENT_SEQUENCE' }

  function item(seq: number, payload: QueuePayload, rejected = false): QueueItem {
    return { seq, payload, rejection: rejected ? REJECTION : null }
  }
  const project = (seq: number, projectId: string, rejected = false) =>
    item(seq, { kind: 'createProject', projectId, name: 'P' }, rejected)
  const site = (seq: number, projectId: string, baitSiteId: string, rejected = false) =>
    item(
      seq,
      {
        kind: 'createBaitSite',
        projectId,
        baitSiteId,
        name: 'S',
        latitude: 0,
        longitude: 0,
        locationAccuracyM: null,
        installation: { id: `${baitSiteId}-installed`, occurredAt: at },
      },
      rejected,
    )
  const event = (seq: number, projectId: string, baitSiteId: string, rejected = false) =>
    item(
      seq,
      {
        kind: 'recordEvent',
        projectId,
        baitSiteId,
        eventId: `event-${seq}`,
        type: 'ACTIVITY',
        occurredAt: at,
        speciesId: null,
        identifiedEventId: null,
      },
      rejected,
    )
  const voidOf = (seq: number, projectId: string, baitSiteId: string, rejected = false) =>
    item(seq, { kind: 'voidEvent', projectId, baitSiteId, eventId: 'event-x' }, rejected)
  const seqs = (queue: readonly QueueItem[]) => sendableItems(queue).map((entry) => entry.seq)

  test('without rejections everything is sendable, in seq order', () => {
    expect(seqs([project(1, 'p'), site(2, 'p', 'a'), event(3, 'p', 'a'), voidOf(4, 'p', 'a')])).toEqual([1, 2, 3, 4])
  })

  test('a rejected event blocks the later items of its site, not those of another site', () => {
    const queue = [event(1, 'p', 'a', true), event(2, 'p', 'b'), event(3, 'p', 'a'), voidOf(4, 'p', 'a'), event(5, 'p', 'b')]
    expect(seqs(queue)).toEqual([2, 5])
  })

  test('a rejected void blocks the later items of its site', () => {
    expect(seqs([voidOf(1, 'p', 'a', true), event(2, 'p', 'a'), event(3, 'p', 'b')])).toEqual([3])
  })

  test('a rejected createBaitSite blocks the events of that site', () => {
    expect(seqs([site(1, 'p', 'a', true), event(2, 'p', 'a'), site(3, 'p', 'b'), event(4, 'p', 'b')])).toEqual([3, 4])
  })

  test('a rejected createProject blocks every item of that project and not of another', () => {
    const queue = [project(1, 'p', true), project(2, 'q'), site(3, 'p', 'a'), site(4, 'q', 'b'), event(5, 'p', 'a'), event(6, 'q', 'b')]
    expect(seqs(queue)).toEqual([2, 4, 6])
  })

  test('an item with a lower seq than the rejected one stays sendable', () => {
    expect(seqs([event(1, 'p', 'a'), event(2, 'p', 'a', true), event(3, 'p', 'a')])).toEqual([1])
  })

  test('after clearRejection everything is sendable again', async () => {
    const store = createFakeLocalStore()
    for (const { payload } of [project(0, 'p'), site(0, 'p', 'a'), event(0, 'p', 'a'), event(0, 'p', 'a')]) {
      await store.enqueue(payload)
    }
    await store.markRejected(1, REJECTION)
    expect(seqs(await store.queuedItems())).toEqual([])

    await store.clearRejection(1)
    expect(seqs(await store.queuedItems())).toEqual([1, 2, 3, 4])
  })
})

describe('parsers', () => {
  const SITE = {
    id: 'site-1',
    name: 'Ipê',
    latitude: -27.1,
    longitude: -49.5,
    locationAccuracyM: 4.5,
    status: 'ARMED',
    createdAt: '2026-11-01T10:00:00Z',
  }
  const EVENT = {
    id: 'event-1',
    baitSiteId: 'site-1',
    type: 'CAPTURED',
    occurredAt: '2026-11-01T10:00:00.123Z',
    speciesId: 'species-1',
    identifiedEventId: null,
    recordedAt: '2026-11-01T10:05:00Z',
    voidedAt: null,
  }
  const SPECIES = { id: 'species-1', scientificName: 'Tetragonisca angustula', commonName: 'Jataí' }

  test('a bait site: known fields only, status not copied, projectId from the caller', () => {
    expect(parseBaitSite({ ...SITE, extra: 'x' }, 'p')).toStrictEqual({
      id: 'site-1',
      projectId: 'p',
      name: 'Ipê',
      latitude: -27.1,
      longitude: -49.5,
      locationAccuracyM: 4.5,
      createdAt: '2026-11-01T10:00:00Z',
    })
    expect(parseBaitSite({ ...SITE, locationAccuracyM: null }, 'p')?.locationAccuracyM).toBeNull()
  })

  test.each<[string, unknown]>([
    ['not an object', 'site'],
    ['null', null],
    ['an array', [SITE]],
    ['id missing', { ...SITE, id: undefined }],
    ['id a number', { ...SITE, id: 1 }],
    ['name missing', { ...SITE, name: undefined }],
    ['latitude a string', { ...SITE, latitude: '-27.1' }],
    ['longitude missing', { ...SITE, longitude: undefined }],
    ['locationAccuracyM missing', { ...SITE, locationAccuracyM: undefined }],
    ['locationAccuracyM a string', { ...SITE, locationAccuracyM: '4' }],
    ['createdAt null', { ...SITE, createdAt: null }],
  ])('a bait site with %s is invalid', (_, value) => {
    expect(parseBaitSite(value, 'p')).toBeNull()
  })

  test('an event: known fields only, occurredAt normalized to 6 decimals, voided flag', () => {
    expect(parseEvent({ ...EVENT, extra: 1 }, 'p')).toStrictEqual({
      event: {
        id: 'event-1',
        projectId: 'p',
        baitSiteId: 'site-1',
        type: 'CAPTURED',
        occurredAt: '2026-11-01T10:00:00.123000Z',
        speciesId: 'species-1',
        identifiedEventId: null,
        recordedAt: '2026-11-01T10:05:00Z',
      },
      voided: false,
    })
    expect(parseEvent({ ...EVENT, voidedAt: '2026-11-02T00:00:00Z' }, 'p')?.voided).toBe(true)
  })

  test.each<[string, unknown]>([
    ['not an object', 42],
    ['id missing', { ...EVENT, id: undefined }],
    ['baitSiteId a number', { ...EVENT, baitSiteId: 3 }],
    ['an unknown type', { ...EVENT, type: 'HATCHED' }],
    ['type missing', { ...EVENT, type: undefined }],
    ['occurredAt null', { ...EVENT, occurredAt: null }],
    ['occurredAt not an instant', { ...EVENT, occurredAt: '2026-11-01' }],
    ['speciesId missing', { ...EVENT, speciesId: undefined }],
    ['speciesId a number', { ...EVENT, speciesId: 1 }],
    ['identifiedEventId missing', { ...EVENT, identifiedEventId: undefined }],
    ['recordedAt missing', { ...EVENT, recordedAt: undefined }],
    ['voidedAt missing', { ...EVENT, voidedAt: undefined }],
    ['voidedAt a boolean', { ...EVENT, voidedAt: true }],
  ])('an event with %s is invalid', (_, value) => {
    expect(parseEvent(value, 'p')).toBeNull()
  })

  test('a species: known fields only', () => {
    expect(parseSpecies({ ...SPECIES, family: 'Apidae' })).toStrictEqual(SPECIES)
  })

  test.each<[string, unknown]>([
    ['id missing', { ...SPECIES, id: undefined }],
    ['scientificName a number', { ...SPECIES, scientificName: 1 }],
    ['commonName null', { ...SPECIES, commonName: null }],
  ])('a species with %s is invalid', (_, value) => {
    expect(parseSpecies(value)).toBeNull()
  })

  test('lists: { items } with every item valid', () => {
    expect(parseBaitSiteList({ items: [SITE, { ...SITE, id: 'site-2' }] }, 'p')?.map((site) => site.id)).toEqual(['site-1', 'site-2'])
    expect(parseProjectEventList({ items: [EVENT] }, 'p')?.map((event) => event.id)).toEqual(['event-1'])
    expect(parseSpeciesList({ items: [SPECIES] })).toEqual([SPECIES])
    expect(parseSpeciesList({ items: [] })).toEqual([])
  })

  test.each<[string, unknown]>([
    ['not an object', [SITE]],
    ['items missing', {}],
    ['items not an array', { items: SITE }],
    ['one bad item', { items: [SITE, { ...SITE, latitude: null }] }],
  ])('a list that is %s is invalid', (_, body) => {
    expect(parseBaitSiteList(body, 'p')).toBeNull()
  })

  test('a voided event makes the project event list invalid', () => {
    expect(parseProjectEventList({ items: [EVENT, { ...EVENT, id: 'event-2', voidedAt: '2026-11-02T00:00:00Z' }] }, 'p')).toBeNull()
  })
})
