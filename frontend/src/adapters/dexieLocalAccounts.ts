import { Dexie, type EntityTable } from 'dexie'
import type { LocalAccounts } from '../core/localAccounts'

// The uid → internal user id mapping (ADR 0008, decision 9) in its own IndexedDB database,
// apart from every user's data. Nothing else lives here. The uid is never logged.

interface AccountRow {
  readonly uid: string
  readonly userId: string
}

class AccountsDatabase extends Dexie {
  // `declare`: Dexie creates the property in version().stores(); see dexieLocalStore.ts.
  declare readonly accounts: EntityTable<AccountRow, 'uid'>

  constructor() {
    super('markcamp-accounts')
    // Schema version rule: until the first real use on the iPhone (slice F2d) version 1 may
    // be edited; after that only a new version (with upgrade() if a row's shape changes),
    // never an edit of an installed one. Dexie compares this version with the database on
    // the device: an edited installed version leaves a schema the code does not know.
    this.version(1).stores({
      accounts: 'uid',
    })
  }
}

/**
 * Opens on first use (Dexie's auto-open), so creating it costs nothing and an open error
 * rejects the first userIdFor/remember. close() is for tests; it deletes nothing.
 */
export function createDexieLocalAccounts(): LocalAccounts & { close(): void } {
  const db = new AccountsDatabase()
  return {
    async userIdFor(uid) {
      return (await db.accounts.get(uid))?.userId ?? null
    },
    async remember(uid, userId) {
      // put, not add: a second remember of the same uid overwrites.
      await db.accounts.put({ uid, userId })
    },
    close() {
      db.close()
    },
  }
}
