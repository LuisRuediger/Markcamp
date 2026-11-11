import type { ApiClient, ApiResult } from './apiClient'
import type { IdGenerator, Logger } from './ports'
import type { SessionKeySource } from './sessionStore'

export type ProjectRole = 'OWNER' | 'MEMBER'

export interface Project {
  readonly id: string
  readonly name: string
  readonly role: ProjectRole
  readonly createdAt: string
}

export type ProjectsSnapshot =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable' }
  | { readonly status: 'ready'; readonly items: readonly Project[] }

export type CreateProjectFailure =
  | 'nameRequired'
  | 'nameTooLong'
  | 'nameInvalid'
  | 'unavailable'
  | 'unknown'

/** What the UI depends on, so tests can pass a fake. In slice F2 it reads from Dexie instead. */
export interface ProjectsStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): ProjectsSnapshot
  reload(): Promise<void>
  /** null on success. */
  create(name: string): Promise<CreateProjectFailure | null>
}

// A switch, not an object lookup: a code such as "constructor" would find Object.prototype.
function nameFailure(fieldCode: string): CreateProjectFailure {
  switch (fieldCode) {
    case 'REQUIRED':
      return 'nameRequired'
    case 'TOO_LONG':
      return 'nameTooLong'
    case 'INVALID_FORMAT':
      return 'nameInvalid'
    default:
      return 'unknown'
  }
}

type CreateOutcome =
  | { readonly kind: 'created'; readonly project: Project }
  | { readonly kind: 'failed'; readonly failure: CreateProjectFailure; readonly forgetId: boolean }

function failed(failure: CreateProjectFailure, forgetId = false): CreateOutcome {
  return { kind: 'failed', failure, forgetId }
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

export function createProjectsStore(
  session: SessionKeySource,
  api: ApiClient,
  ids: IdGenerator,
  logger: Logger,
): ProjectsStore {
  let snapshot: ProjectsSnapshot = { status: 'idle' }
  let sessionKey: number | null = null
  // The ID of the creation that has not succeeded yet. Reused on every retry, so a lost
  // response followed by a retry cannot create the project twice (ADR 0002, rule 2).
  let pendingId: string | null = null
  // Within one session, only the newest list request may write the snapshot: an older one
  // that answers last would bring back a list from before a creation.
  let latestLoad = 0
  const listeners = new Set<() => void>()

  function setSnapshot(next: ProjectsSnapshot): void {
    snapshot = next
    listeners.forEach((listener) => listener())
  }

  async function load(): Promise<void> {
    const key = sessionKey
    if (key === null) return
    latestLoad += 1
    const thisLoad = latestLoad

    const result = await api.request({ method: 'GET', path: '/projects' })
    // A late answer from an earlier session: another person's projects must never appear.
    if (key !== sessionKey) return
    if (thisLoad !== latestLoad) return

    let items: readonly Project[] | null = null
    if (result.kind === 'ok') {
      items = parseProjectList(result.body)
      if (items === null) logger.error('GET /projects returned a body that is not a valid project list.')
    }
    if (items !== null) {
      setSnapshot({ status: 'ready', items })
    } else if (snapshot.status !== 'ready') {
      // A failed reload keeps the items already shown.
      setSnapshot({ status: 'unavailable' })
    }
  }

  function reload(): Promise<void> {
    if (sessionKey === null) return Promise.resolve()
    if (snapshot.status === 'unavailable') setSnapshot({ status: 'loading' })
    return load()
  }

  function handleSessionChange(): void {
    const key = session.getSessionKey()
    if (key === sessionKey) return
    sessionKey = key
    pendingId = null
    if (key === null) {
      if (snapshot.status !== 'idle') setSnapshot({ status: 'idle' })
      return
    }
    setSnapshot({ status: 'loading' })
    void load()
  }

  function putProject(project: Project): void {
    if (snapshot.status !== 'ready') return // The reload that follows brings it.
    const index = snapshot.items.findIndex((item) => item.id === project.id)
    // Never sorted here: the server's order is (created_at, id), see ADR 0007 rule 8.
    const items =
      index === -1
        ? [...snapshot.items, project]
        : snapshot.items.map((item, i) => (i === index ? project : item))
    setSnapshot({ status: 'ready', items })
  }

  function validationOutcome(result: Extract<ApiResult, { kind: 'apiError' }>): CreateOutcome {
    let forgetId = false
    if (result.fieldErrors.some((error) => error.field === 'id')) {
      // Our own ID was rejected: retrying with it can never work.
      logger.error('POST /projects rejected the client-generated id.')
      forgetId = true
    }
    const nameError = result.fieldErrors.find((error) => error.field === 'name')
    return failed(nameError === undefined ? 'unknown' : nameFailure(nameError.code), forgetId)
  }

  /** After ID_ALREADY_EXISTS: either our earlier attempt was stored, or the ID is not ours. */
  async function confirm(id: string): Promise<CreateOutcome> {
    const result = await api.request({ method: 'GET', path: `/projects/${id}` })
    switch (result.kind) {
      case 'ok': {
        const project = parseProject(result.body)
        if (project !== null) return { kind: 'created', project }
        logger.error('GET /projects/{id} returned a body that is not a valid project.')
        return failed('unknown')
      }
      case 'apiError':
        if (result.status === 404) {
          // A UUID v7 collision is not realistic: this is a client bug.
          logger.error('POST /projects answered ID_ALREADY_EXISTS for an id that is not ours.')
          return failed('unknown', true)
        }
        return failed('unknown')
      case 'unavailable':
        return failed('unavailable')
      case 'unauthorized':
        return failed('unknown') // The session store already signs out.
    }
  }

  async function attempt(id: string, name: string): Promise<CreateOutcome> {
    const result = await api.request({ method: 'POST', path: '/projects', body: { id, name } })
    switch (result.kind) {
      case 'ok': {
        const project = parseProject(result.body)
        if (project !== null) return { kind: 'created', project }
        logger.error('POST /projects returned a body that is not a valid project.')
        return failed('unknown')
      }
      case 'apiError':
        if (result.code === 'ID_ALREADY_EXISTS') return confirm(id)
        if (result.code === 'VALIDATION_FAILED') return validationOutcome(result)
        return failed('unknown') // Including 5xx: the same ID is kept, so retrying is safe.
      case 'unavailable':
        return failed('unavailable')
      case 'unauthorized':
        return failed('unknown') // The session store already signs out.
    }
  }

  session.subscribe(handleSessionChange)
  handleSessionChange()

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    reload,
    async create(name) {
      const key = sessionKey
      if (key === null) return 'unknown'
      // Synchronous, before the first await: two calls that slip through together (a double
      // tap) share the ID, so the second one gets ID_ALREADY_EXISTS instead of a duplicate.
      pendingId ??= ids.newId()
      const id = pendingId

      const outcome = await attempt(id, name)
      // The person who asked still gets the answer, but an ended session's store state is not touched.
      if (key !== sessionKey) return outcome.kind === 'created' ? null : outcome.failure

      if (outcome.kind === 'failed') {
        if (outcome.forgetId && pendingId === id) pendingId = null
        return outcome.failure
      }
      if (pendingId === id) pendingId = null
      putProject(outcome.project)
      void reload()
      return null
    },
  }
}
