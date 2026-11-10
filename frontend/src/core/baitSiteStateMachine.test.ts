import { expect, test } from 'vitest'
import { replay } from './baitSiteStateMachine'

// The cases file (contract/baitSiteStateMachine.contract.test.ts) is the main test.
// These cover only what its format cannot express.

test('IDENTIFIED is matched by id, not by position: identify the first of two captures', () => {
  const result = replay([
    { id: 'installed', type: 'INSTALLED', identifiedEventId: null },
    { id: 'capture-1', type: 'CAPTURED', identifiedEventId: null },
    { id: 'lost', type: 'LOST', identifiedEventId: null },
    { id: 'capture-2', type: 'CAPTURED', identifiedEventId: null },
    { id: 'identified', type: 'IDENTIFIED', identifiedEventId: 'capture-1' },
  ])

  expect(result).toEqual({ valid: true, status: 'CAPTURED' })
})

test('IDENTIFIED with no target is invalid', () => {
  const result = replay([
    { id: 'installed', type: 'INSTALLED', identifiedEventId: null },
    { id: 'capture', type: 'CAPTURED', identifiedEventId: null },
    { id: 'identified', type: 'IDENTIFIED', identifiedEventId: null },
  ])

  expect(result).toEqual({ valid: false, firstInvalidIndex: 2 })
})
