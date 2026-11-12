import type { ProjectListEntry } from './localMerge'
import type { SyncStatus } from './syncEngine'

// What the sync indicator on the screen says. Pure, so the order of the rules is tested as a
// table. Rejected items are not counted (they show on their own row); a pending item keeps
// the indicator off "synced" even when the engine's last pass was synced (the engine's
// 'synced' does not count what entered the queue after it).
//
// Known limit: the count comes from the projects view, which is enough while the queue can
// only hold createProject items. Bait sites and events (slice F3) will need a count of the
// whole queue.

export type SyncIndicator =
  | { readonly kind: 'syncing' }
  | { readonly kind: 'offline'; readonly pendingCount: number }
  | { readonly kind: 'pending'; readonly pendingCount: number }
  | { readonly kind: 'notYet' }
  | { readonly kind: 'synced' }

export function syncIndicator(status: SyncStatus, projects: readonly ProjectListEntry[]): SyncIndicator {
  if (status.phase !== 'idle') return { kind: 'syncing' }
  const pendingCount = projects.filter((entry) => entry.pending && entry.rejection === null).length
  if (status.lastResult === 'unavailable') return { kind: 'offline', pendingCount }
  if (pendingCount > 0) return { kind: 'pending', pendingCount }
  if (status.lastResult === 'never') return { kind: 'notYet' }
  return { kind: 'synced' }
}
