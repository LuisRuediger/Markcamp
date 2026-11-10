import { describe, expect, it } from 'vitest'
import type { LocalAccounts } from './localAccounts'

// The behaviour every LocalAccounts must have, written once. Run by fakeLocalAccounts.test.ts
// and by the Dexie adapter's test, like localStore.suite.ts. Not a *.test.ts file, so Vitest
// does not run it on its own.

export function describeLocalAccounts(name: string, create: () => Promise<LocalAccounts>): void {
  describe(`LocalAccounts contract: ${name}`, () => {
    it('gives null for a uid never remembered', async () => {
      const accounts = await create()

      expect(await accounts.userIdFor('uid-a')).toBeNull()
    })

    it('gives the remembered id', async () => {
      const accounts = await create()

      await accounts.remember('uid-a', 'user-1')

      expect(await accounts.userIdFor('uid-a')).toBe('user-1')
    })

    it('overwrites the id on a second remember of the same uid', async () => {
      const accounts = await create()
      await accounts.remember('uid-a', 'user-1')

      await accounts.remember('uid-a', 'user-2')

      expect(await accounts.userIdFor('uid-a')).toBe('user-2')
    })

    it('never mixes two uids', async () => {
      const accounts = await create()

      await accounts.remember('uid-a', 'user-1')
      await accounts.remember('uid-b', 'user-2')

      expect(await accounts.userIdFor('uid-a')).toBe('user-1')
      expect(await accounts.userIdFor('uid-b')).toBe('user-2')
      expect(await accounts.userIdFor('uid-c')).toBeNull()
    })
  })
}
