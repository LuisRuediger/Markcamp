import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStoragePersistence } from './storagePersistence'

/** The adapter reads only navigator.storage. */
function stubStorage(storage: unknown): void {
  vi.stubGlobal('navigator', { storage })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StoragePersistence adapter', () => {
  it('is unsupported without navigator.storage', async () => {
    stubStorage(undefined)

    expect(await createStoragePersistence().request()).toBe('unsupported')
  })

  it('is unsupported without persist()', async () => {
    stubStorage({ persisted: async () => false })

    expect(await createStoragePersistence().request()).toBe('unsupported')
  })

  it('is already persisted without calling persist()', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => true, persist })

    expect(await createStoragePersistence().request()).toBe('alreadyPersisted')
    expect(persist).not.toHaveBeenCalled()
  })

  it('is granted when persist() gives true', async () => {
    const persist = vi.fn(async () => true)
    stubStorage({ persisted: async () => false, persist })

    expect(await createStoragePersistence().request()).toBe('granted')
    expect(persist).toHaveBeenCalledOnce()
  })

  it('is denied when persist() gives false', async () => {
    stubStorage({ persisted: async () => false, persist: async () => false })

    expect(await createStoragePersistence().request()).toBe('denied')
  })

  it('is unsupported, never a rejection, when the browser throws', async () => {
    stubStorage({
      persisted: async () => false,
      persist: async () => {
        throw new Error('blocked')
      },
    })

    expect(await createStoragePersistence().request()).toBe('unsupported')
  })
})
