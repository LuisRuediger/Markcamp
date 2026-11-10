import type { PersistOutcome, StoragePersistence } from '../core/ports'

/**
 * navigator.storage.persist() behind the core port (ADR 0008, decision 11). Never rejects
 * and does not log: the caller logs the outcome as a fixed phrase.
 */
export function createStoragePersistence(): StoragePersistence {
  return {
    async request(): Promise<PersistOutcome> {
      try {
        // Optional chaining although the DOM types say it is always there: older browsers
        // and insecure contexts have no navigator.storage.
        const storage = navigator.storage
        if (typeof storage?.persisted !== 'function' || typeof storage?.persist !== 'function') return 'unsupported'
        if (await storage.persisted()) return 'alreadyPersisted'
        return (await storage.persist()) ? 'granted' : 'denied'
      } catch {
        return 'unsupported'
      }
    },
  }
}
