import type { ProjectListEntry } from '../core/localMerge'
import type { Loadable } from '../core/localStore'

// Where a ready session opens (decision T10 of slice F4-2b): the map of the last project the
// user opened, if it is still in the list; otherwise Projects. App.tsx decides once per ready
// snapshot, so a later change of the list never moves the user.

export type StartScreen =
  | { readonly kind: 'deciding' }
  | { readonly kind: 'projects' }
  | { readonly kind: 'map'; readonly projectId: string }

const DECIDING: StartScreen = { kind: 'deciding' }
const PROJECTS: StartScreen = { kind: 'projects' }

/**
 * `deciding` until both are loaded. The merged list counts: a project still pending, or
 * rejected, is in it. Ids are compared as plain strings (ADR 0007 rule 8).
 */
export function startScreen(lastProjectId: Loadable<string | null>, projects: Loadable<readonly ProjectListEntry[]>): StartScreen {
  if (lastProjectId.status === 'loading' || projects.status === 'loading') return DECIDING
  const projectId = lastProjectId.value
  if (projectId !== null && projects.value.some((entry) => entry.id === projectId)) return { kind: 'map', projectId }
  return PROJECTS
}
