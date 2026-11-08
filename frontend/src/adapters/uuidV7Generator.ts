import { v7 } from 'uuid'
import type { IdGenerator } from '../core/ports'

/** RFC 9562 UUID v7, which crypto.randomUUID (v4 only) cannot produce. Output is canonical lowercase. */
export function createUuidV7Generator(): IdGenerator {
  return { newId: () => v7() }
}
