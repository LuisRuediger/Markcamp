import { expect, test } from 'vitest'
import { countPending } from './localMerge'
import { LOADING, type Loadable, type QueueItem } from './localStore'
import type { SyncPhase, SyncResult } from './syncEngine'
import { syncIndicator, type SyncIndicator } from './syncIndicator'

const count = (value: number): Loadable<number> => ({ status: 'ready', value })

// A queue holding only a rejected item: the count the session view would give is 0.
const ONLY_REJECTED: readonly QueueItem[] = [
  {
    seq: 1,
    payload: { kind: 'voidEvent', projectId: 'p-1', baitSiteId: 's-1', eventId: 'e-1' },
    rejection: { status: 409, code: 'INVALID_EVENT_SEQUENCE' },
  },
]

test.each<[string, SyncPhase, SyncResult, Loadable<number>, SyncIndicator]>([
  ['uploading with pending items', 'uploading', 'synced', count(1), { kind: 'syncing' }],
  ['downloading, never synced', 'downloading', 'never', count(0), { kind: 'syncing' }],
  ['uploading after unavailable', 'uploading', 'unavailable', count(1), { kind: 'syncing' }],
  ['uploading while the count is loading', 'uploading', 'synced', LOADING, { kind: 'syncing' }],
  ['count loading after a synced pass: never synced', 'idle', 'synced', LOADING, { kind: 'notYet' }],
  ['count loading after unavailable', 'idle', 'unavailable', LOADING, { kind: 'notYet' }],
  ['count loading, never synced', 'idle', 'never', LOADING, { kind: 'notYet' }],
  ['unavailable with nothing pending', 'idle', 'unavailable', count(0), { kind: 'offline', pendingCount: 0 }],
  ['unavailable with two pending', 'idle', 'unavailable', count(2), { kind: 'offline', pendingCount: 2 }],
  ['synced with one pending (the F2c case)', 'idle', 'synced', count(1), { kind: 'pending', pendingCount: 1 }],
  ['never with one pending', 'idle', 'never', count(1), { kind: 'pending', pendingCount: 1 }],
  ['never with nothing pending', 'idle', 'never', count(0), { kind: 'notYet' }],
  ['never with only a rejected item', 'idle', 'never', count(countPending(ONLY_REJECTED)), { kind: 'notYet' }],
  ['synced with nothing pending', 'idle', 'synced', count(0), { kind: 'synced' }],
  ['synced with only a rejected item', 'idle', 'synced', count(countPending(ONLY_REJECTED)), { kind: 'synced' }],
])('%s', (_name, phase, lastResult, pending, expected) => {
  expect(syncIndicator({ phase, lastResult }, pending)).toEqual(expected)
})
