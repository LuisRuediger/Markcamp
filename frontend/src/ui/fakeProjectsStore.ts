import { vi } from 'vitest'
import type { ProjectsSnapshot, ProjectsStore } from '../core/projectsStore'

// Test helper. A fixed snapshot: list transitions belong to the projects store's own tests.
export function createFakeProjectsStore(
  snapshot: ProjectsSnapshot = { status: 'ready', items: [] },
) {
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    reload: vi.fn<ProjectsStore['reload']>(async () => {}),
    create: vi.fn<ProjectsStore['create']>(async () => null),
  } satisfies ProjectsStore
}
