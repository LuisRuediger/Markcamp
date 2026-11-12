// A project as the server confirms it (GET /projects, POST /projects, GET /projects/{id}).

export type ProjectRole = 'OWNER' | 'MEMBER'

export interface Project {
  readonly id: string
  readonly name: string
  readonly role: ProjectRole
  readonly createdAt: string
}

/** Copies only the known fields: the snapshot never carries anything else from a body. */
export function parseProject(value: unknown): Project | null {
  if (typeof value !== 'object' || value === null) return null
  const { id, name, role, createdAt } = value as Record<string, unknown>
  if (typeof id !== 'string' || typeof name !== 'string' || typeof createdAt !== 'string') return null
  if (role !== 'OWNER' && role !== 'MEMBER') return null
  return { id, name, role, createdAt }
}

export function parseProjectList(body: unknown): readonly Project[] | null {
  if (typeof body !== 'object' || body === null || !('items' in body)) return null
  const items: unknown = body.items
  if (!Array.isArray(items)) return null
  const projects: Project[] = []
  for (const item of items as readonly unknown[]) {
    const project = parseProject(item)
    if (project === null) return null
    projects.push(project)
  }
  return projects
}
