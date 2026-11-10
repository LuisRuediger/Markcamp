import 'fake-indexeddb/auto'
import { Dexie } from 'dexie'
import { afterEach } from 'vitest'
import { describeLocalAccounts } from '../core/localAccounts.suite'
import { createDexieLocalAccounts } from './dexieLocalAccounts'

// The adapter always uses the real name, markcamp-accounts, so tests share one database
// name: each test gets a fresh one by closing the previous connection and deleting it
// (a delete waits for open connections, so close first).
let current: ReturnType<typeof createDexieLocalAccounts> | null = null

afterEach(async () => {
  current?.close()
  current = null
  await Dexie.delete('markcamp-accounts')
})

describeLocalAccounts('Dexie', async () => {
  current = createDexieLocalAccounts()
  return current
})
