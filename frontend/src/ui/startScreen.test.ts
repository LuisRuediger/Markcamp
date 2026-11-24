import { describe, expect, test } from 'vitest'
import type { ProjectListEntry } from '../core/localMerge'
import { LOADING, type Loadable } from '../core/localStore'
import { startScreen } from './startScreen'

function entry(id: string, change: Partial<ProjectListEntry> = {}): ProjectListEntry {
  return { id, name: 'Farm', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z', pending: false, rejection: null, ...change }
}

function ready<T>(value: T): Loadable<T> {
  return { status: 'ready', value }
}

const LIST = ready([entry('p-1'), entry('p-2')])

describe('startScreen', () => {
  test.each([
    ['the last project', LOADING, LIST],
    ['the list', ready('p-1'), LOADING],
    ['both', LOADING, LOADING],
  ] as const)('deciding while %s is loading', (_, lastProjectId, projects) => {
    expect(startScreen(lastProjectId, projects)).toEqual({ kind: 'deciding' })
  })

  test('nothing stored: Projects', () => {
    expect(startScreen(ready(null), LIST)).toEqual({ kind: 'projects' })
  })

  test('stored and in the list: its map', () => {
    expect(startScreen(ready('p-2'), LIST)).toEqual({ kind: 'map', projectId: 'p-2' })
  })

  test('stored but no longer in the list: Projects', () => {
    expect(startScreen(ready('p-9'), LIST)).toEqual({ kind: 'projects' })
  })

  test('an empty list: Projects', () => {
    expect(startScreen(ready('p-1'), ready([]))).toEqual({ kind: 'projects' })
  })

  test.each([
    ['pending', entry('p-3', { pending: true, createdAt: null })],
    ['rejected', entry('p-3', { pending: true, createdAt: null, rejection: { seq: 4, status: 422, code: 'VALIDATION_FAILED' } })],
  ])('a %s entry counts: its map', (_, pendingEntry) => {
    expect(startScreen(ready('p-3'), ready([entry('p-1'), pendingEntry]))).toEqual({ kind: 'map', projectId: 'p-3' })
  })

  test('ids are compared exactly: no case folding', () => {
    expect(startScreen(ready('P-1'), LIST)).toEqual({ kind: 'projects' })
  })
})
