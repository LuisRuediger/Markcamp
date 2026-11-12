import { expect, test } from 'vitest'
import type { ProjectListEntry } from './localMerge'
import type { SyncPhase, SyncResult } from './syncEngine'
import { syncIndicator, type SyncIndicator } from './syncIndicator'

function entry(id: string, state: 'confirmed' | 'pending' | 'rejected'): ProjectListEntry {
  return {
    id,
    name: id,
    role: 'OWNER',
    createdAt: state === 'confirmed' ? '2026-11-01T12:00:00Z' : null,
    pending: state !== 'confirmed',
    rejection: state === 'rejected' ? { seq: 1, status: 400, code: 'VALIDATION_FAILED' } : null,
  }
}

const NONE: readonly ProjectListEntry[] = []
const ONE_PENDING = [entry('a', 'confirmed'), entry('b', 'pending')]
const TWO_PENDING_ONE_REJECTED = [entry('a', 'pending'), entry('b', 'pending'), entry('c', 'rejected')]
const ONLY_REJECTED = [entry('a', 'confirmed'), entry('b', 'rejected')]

test.each<[string, SyncPhase, SyncResult, readonly ProjectListEntry[], SyncIndicator]>([
  ['uploading with pending entries', 'uploading', 'synced', ONE_PENDING, { kind: 'syncing' }],
  ['downloading, never synced', 'downloading', 'never', NONE, { kind: 'syncing' }],
  ['uploading after unavailable', 'uploading', 'unavailable', ONE_PENDING, { kind: 'syncing' }],
  ['unavailable with nothing pending', 'idle', 'unavailable', NONE, { kind: 'offline', pendingCount: 0 }],
  ['unavailable, two pending and one rejected', 'idle', 'unavailable', TWO_PENDING_ONE_REJECTED, { kind: 'offline', pendingCount: 2 }],
  ['synced with one pending (the F2c case)', 'idle', 'synced', ONE_PENDING, { kind: 'pending', pendingCount: 1 }],
  ['never with one pending', 'idle', 'never', ONE_PENDING, { kind: 'pending', pendingCount: 1 }],
  ['never with nothing pending', 'idle', 'never', NONE, { kind: 'notYet' }],
  ['never with only a rejected entry', 'idle', 'never', ONLY_REJECTED, { kind: 'notYet' }],
  ['synced with nothing pending', 'idle', 'synced', [entry('a', 'confirmed')], { kind: 'synced' }],
  ['synced with only a rejected entry', 'idle', 'synced', ONLY_REJECTED, { kind: 'synced' }],
])('%s', (_name, phase, lastResult, projects, expected) => {
  expect(syncIndicator({ phase, lastResult }, projects)).toEqual(expected)
})
