import { expect, test } from 'vitest'
import { createUuidV7Generator } from './uuidV7Generator'

// The backend's strict parser rules (ADR 0002), written out here on purpose rather than shared:
// canonical lowercase 8-4-4-4-12, version nibble 7, variant 8 to b.
const CANONICAL_LOWERCASE_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

test('1000 IDs are distinct and all canonical lowercase UUID v7', () => {
  const generator = createUuidV7Generator()

  const ids = Array.from({ length: 1000 }, () => generator.newId())

  expect(new Set(ids).size).toBe(1000)
  for (const id of ids) expect(id).toMatch(CANONICAL_LOWERCASE_V7)
})
