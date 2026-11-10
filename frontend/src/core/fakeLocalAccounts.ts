import type { LocalAccounts } from './localAccounts'

// An in-memory LocalAccounts with the same contract as the Dexie adapter
// (localAccounts.suite.ts runs against both). A normal module, not a test file: the
// session's tests use it.

export function createFakeLocalAccounts(): LocalAccounts {
  const userIds = new Map<string, string>()
  return {
    async userIdFor(uid) {
      return userIds.get(uid) ?? null
    },
    async remember(uid, userId) {
      userIds.set(uid, userId)
    },
  }
}
