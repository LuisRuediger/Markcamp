import type { Loadable } from './localStore'
import type { SyncStatus } from './syncEngine'

// What the sync indicator on the screen says. Pure, so the order of the rules is tested as a
// table. The count is every queue item still waiting (countPending in localMerge.ts: rejected
// items are not counted, they show on their own row). A pending item keeps the indicator off
// "synced" even when the engine's last pass was synced (the engine's 'synced' does not count
// what entered the queue after it). While the count is still loading the indicator never
// says "synced": an unknown count may hold records not yet sent.

export type SyncIndicator =
  | { readonly kind: 'syncing' }
  | { readonly kind: 'offline'; readonly pendingCount: number }
  | { readonly kind: 'pending'; readonly pendingCount: number }
  | { readonly kind: 'notYet' }
  | { readonly kind: 'synced' }

export function syncIndicator(status: SyncStatus, pending: Loadable<number>): SyncIndicator {
  if (status.phase !== 'idle') return { kind: 'syncing' }
  if (pending.status === 'loading') return { kind: 'notYet' }
  const pendingCount = pending.value
  if (status.lastResult === 'unavailable') return { kind: 'offline', pendingCount }
  if (pendingCount > 0) return { kind: 'pending', pendingCount }
  if (status.lastResult === 'never') return { kind: 'notYet' }
  return { kind: 'synced' }
}
