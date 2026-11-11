import type { ApiClient, ApiRequest, ApiResult } from './apiClient'
import type { Confirmation, LocalEvent, LocalStore, QueueItem, QueueRejection } from './localStore'
import type { Logger, Timers } from './ports'
import { parseProject, parseProjectList } from './projectsStore'
import {
  ID_NOT_OURS,
  LIST_PROJECTS_REQUEST,
  LIST_SPECIES_REQUEST,
  classifyFollowUp,
  classifyResult,
  createBaitSiteRequest,
  createProjectRequest,
  getBaitSiteRequest,
  getEventRequest,
  getProjectRequest,
  listBaitSitesRequest,
  listProjectEventsRequest,
  parseBaitSite,
  parseBaitSiteList,
  parseEvent,
  parseProjectEventList,
  parseSpeciesList,
  recordEventRequest,
  sendableItems,
  voidEventRequest,
} from './syncProtocol'

// The sync engine (ADR 0007: the only code that sends domain data to the API or brings it
// back; ADR 0008: upload the queue, then download the project snapshots). It depends only on
// ports; who starts it (app open, `online`, a new item, the button) is wired in slice F2d.

export type SyncPhase = 'idle' | 'uploading' | 'downloading'
export type SyncResult = 'never' | 'synced' | 'unavailable'

export interface SyncStatus {
  readonly phase: SyncPhase
  /** 'synced': the upload was not deferred and no download is owed. Rejected items do not count. */
  readonly lastResult: SyncResult
}

/**
 * Pending and rejected counts are not here: screens read them from the merge (localMerge.ts),
 * the only place pending data reaches a screen (ADR 0008, rule 1).
 */
export interface SyncEngine {
  subscribe(listener: () => void): () => void
  /** The same object (===) while nothing changed. */
  getSnapshot(): SyncStatus
  /**
   * 'upload' sends the queue; 'full' also owes a download, which runs in the first pass
   * whose upload was not deferred. Resolves when the engine is idle again. Never rejects.
   */
  requestSync(kind: 'upload' | 'full'): Promise<void>
  /** For the end of the session: nothing is written and nobody is notified afterwards. */
  stop(): void
}

export interface SyncEngineDeps {
  readonly api: Pick<ApiClient, 'request'>
  readonly store: LocalStore
  readonly timers: Timers
  readonly logger: Logger
}

/** ADR 0008, decision 5: while the app is open and something is left to send. */
const SAFETY_TIMER_MS = 60_000

/** How one queue item ended. */
type Attempt =
  | { readonly kind: 'confirm'; readonly confirmation: Confirmation }
  | { readonly kind: 'defer' }
  | { readonly kind: 'reject'; readonly rejection: QueueRejection }

const DEFER: { readonly kind: 'defer' } = { kind: 'defer' }

/** A step that produced a value, or the end of the attempt. */
type Step<T> = { readonly kind: 'value'; readonly value: T } | Exclude<Attempt, { readonly kind: 'confirm' }>

/** Thrown after stop(): unwinds the pass without writing or notifying. Never escapes the engine. */
class Stopped extends Error {}

interface PassOutcome {
  readonly result: SyncResult
  readonly sendableLeft: boolean
}

export function createSyncEngine({ api, store, timers, logger }: SyncEngineDeps): SyncEngine {
  let status: SyncStatus = { phase: 'idle', lastResult: 'never' }
  const listeners = new Set<() => void>()
  let stopped = false
  /** The run in progress (one or more passes); every requestSync during it shares it. */
  let running: Promise<void> | null = null
  let runAgain = false
  /** A requested download not yet done (E4): it waits for a pass whose upload was not deferred. */
  let downloadOwed = false
  let cancelTimer: (() => void) | null = null

  function setStatus(phase: SyncPhase, lastResult: SyncResult = status.lastResult): void {
    if (stopped) return
    if (phase === status.phase && lastResult === status.lastResult) return
    status = { phase, lastResult }
    for (const listener of [...listeners]) listener()
  }

  function throwIfStopped(): void {
    if (stopped) throw new Stopped()
  }

  function disarmTimer(): void {
    cancelTimer?.()
    cancelTimer = null
  }

  function armTimer(): void {
    disarmTimer()
    cancelTimer = timers.after(SAFETY_TIMER_MS, () => {
      cancelTimer = null
      void requestSync('upload')
    })
  }

  /** Every request goes through here: one at a time, and an answer that arrives after stop() is dropped. */
  async function send(request: ApiRequest): Promise<ApiResult> {
    throwIfStopped()
    const result = await api.request(request)
    throwIfStopped()
    return result
  }

  function invalidBody(phrase: string): Step<never> {
    logger.error(phrase)
    return DEFER
  }

  /**
   * The create request. An ok with an invalid body defers: the server did store it, and a
   * rejection would invite the user to discard a record that exists.
   */
  async function post<T>(
    request: ApiRequest,
    parse: (body: unknown) => T | null,
    phrase: string,
  ): Promise<Step<T> | { readonly kind: 'lookUp' }> {
    const action = classifyResult(await send(request))
    switch (action.kind) {
      case 'confirm': {
        const value = parse(action.body)
        return value === null ? invalidBody(phrase) : { kind: 'value', value }
      }
      case 'lookUp':
      case 'defer':
      case 'reject':
        return action
    }
  }

  /** A follow-up GET (classifyFollowUp). */
  async function get<T>(
    request: ApiRequest,
    afterIdAlreadyExists: boolean,
    parse: (body: unknown) => T | null,
    phrase: string,
  ): Promise<Step<T>> {
    const action = classifyFollowUp(await send(request), afterIdAlreadyExists)
    switch (action.kind) {
      case 'confirm': {
        const value = parse(action.body)
        return value === null ? invalidBody(phrase) : { kind: 'value', value }
      }
      case 'idNotOurs':
        // A UUID v7 collision is not realistic: this is a client bug.
        logger.error('Sync upload: a create answered ID_ALREADY_EXISTS for an id that is not ours.')
        return { kind: 'reject', rejection: ID_NOT_OURS }
      case 'defer':
      case 'reject':
        return action
    }
  }

  /**
   * GET of an event the copy should hold. The copy keeps only non-voided events, so a voided
   * one cannot confirm the item. With one device nothing can void an event that has not
   * been confirmed yet, so this does not happen in the MVP.
   */
  async function getLiveEvent(
    request: ApiRequest,
    afterIdAlreadyExists: boolean,
    projectId: string,
  ): Promise<Step<LocalEvent>> {
    const step = await get(
      request,
      afterIdAlreadyExists,
      (body) => parseEvent(body, projectId),
      'Sync upload: GET of an event returned a body that is not a valid event.',
    )
    if (step.kind !== 'value') return step
    if (step.value.voided) {
      logger.error('Sync upload: the event behind a queue item is voided on the server.')
      return { kind: 'reject', rejection: ID_NOT_OURS }
    }
    return { kind: 'value', value: step.value.event }
  }

  /** Talks to the API only: the caller writes the outcome. No default branch. */
  async function attempt({ payload }: QueueItem): Promise<Attempt> {
    switch (payload.kind) {
      case 'createProject': {
        const posted = await post(
          createProjectRequest(payload),
          parseProject,
          'Sync upload: POST /projects returned a body that is not a valid project.',
        )
        const project =
          posted.kind === 'lookUp'
            ? await get(
                getProjectRequest(payload.projectId),
                true,
                parseProject,
                'Sync upload: GET /projects/{id} returned a body that is not a valid project.',
              )
            : posted
        if (project.kind !== 'value') return project
        return { kind: 'confirm', confirmation: { kind: 'projectCreated', project: project.value } }
      }

      case 'createBaitSite': {
        const { projectId, baitSiteId } = payload
        const parseSite = (body: unknown) => parseBaitSite(body, projectId)
        const posted = await post(
          createBaitSiteRequest(payload),
          parseSite,
          'Sync upload: POST of a bait site returned a body that is not a valid bait site.',
        )
        const afterIdAlreadyExists = posted.kind === 'lookUp'
        const baitSite = afterIdAlreadyExists
          ? await get(
              getBaitSiteRequest(projectId, baitSiteId),
              true,
              parseSite,
              'Sync upload: GET of a bait site returned a body that is not a valid bait site.',
            )
          : posted
        if (baitSite.kind !== 'value') return baitSite
        // Confirmed only together with its INSTALLED (P3). If this GET is deferred the item
        // stays, and the next attempt goes 409 -> GET site -> GET INSTALLED.
        const installed = await getLiveEvent(
          getEventRequest(projectId, baitSiteId, payload.installation.id),
          afterIdAlreadyExists,
          projectId,
        )
        if (installed.kind !== 'value') return installed
        return {
          kind: 'confirm',
          confirmation: { kind: 'baitSiteCreated', baitSite: baitSite.value, installed: installed.value },
        }
      }

      case 'recordEvent': {
        const { projectId, baitSiteId, eventId } = payload
        // An event just recorded cannot come back voided: if it does, the body is broken.
        const parseRecorded = (body: unknown) => {
          const parsed = parseEvent(body, projectId)
          return parsed === null || parsed.voided ? null : parsed.event
        }
        const posted = await post(
          recordEventRequest(payload),
          parseRecorded,
          'Sync upload: POST of an event returned a body that is not a valid event.',
        )
        const event =
          posted.kind === 'lookUp'
            ? await getLiveEvent(getEventRequest(projectId, baitSiteId, eventId), true, projectId)
            : posted
        if (event.kind !== 'value') return event
        return { kind: 'confirm', confirmation: { kind: 'eventRecorded', event: event.value } }
      }

      case 'voidEvent': {
        const { projectId, baitSiteId, eventId } = payload
        // The confirmation carries only the id, so the store cannot check the body: it must
        // be this event, voided.
        const parseVoided = (body: unknown) => {
          const parsed = parseEvent(body, projectId)
          if (parsed === null || !parsed.voided) return null
          return parsed.event.id === eventId && parsed.event.baitSiteId === baitSiteId ? parsed.event : null
        }
        const posted = await post(
          voidEventRequest(payload),
          parseVoided,
          'Sync upload: POST of a void returned a body that is not the voided event.',
        )
        // A void is idempotent and never answers ID_ALREADY_EXISTS (ADR 0006); if it did, it
        // would be one more 4xx: rejected with its status and code.
        if (posted.kind === 'lookUp') return { kind: 'reject', rejection: ID_NOT_OURS }
        if (posted.kind !== 'value') return posted
        return { kind: 'confirm', confirmation: { kind: 'eventVoided', eventId } }
      }
    }
  }

  /**
   * One item at a time, in seq order, skipping items that are not sendable. The queue is read
   * again after every item: one may be enqueued or discarded while a request is in flight.
   * Ends because every attempt either removes the item (confirm), makes it unsendable
   * (reject) or ends the upload (defer).
   */
  async function upload(): Promise<'done' | 'deferred'> {
    const attempted = new Set<number>()
    for (;;) {
      const queue = await store.queuedItems()
      throwIfStopped()
      const [next] = sendableItems(queue)
      if (next === undefined) return 'done'
      // Only possible if the user retried this item during the pass: it waits for the next
      // pass (the safety timer is armed), so no item is ever sent twice in one pass.
      if (attempted.has(next.seq)) return 'done'
      attempted.add(next.seq)

      const outcome = await attempt(next)
      throwIfStopped()
      switch (outcome.kind) {
        case 'confirm':
          // 'itemMissing' (discarded in flight) writes nothing; the next snapshot brings the truth.
          await store.confirm(next.seq, outcome.confirmation)
          break
        case 'reject':
          // No automatic retry, ever (ADR 0008, decision 6): only the user's clearRejection.
          await store.markRejected(next.seq, outcome.rejection)
          break
        case 'defer':
          return 'deferred'
      }
    }
  }

  async function fetchBody<T>(
    request: ApiRequest,
    parse: (body: unknown) => T | null,
    phrase: string,
  ): Promise<T | null> {
    const result = await send(request)
    if (result.kind !== 'ok') return null
    const value = parse(result.body)
    if (value === null) logger.error(phrase)
    return value
  }

  /**
   * Projects, species once, then each project's bait sites and events. Any failure stops it;
   * what was already written stays (each replace is atomic per project). Never reads or
   * writes the queue (ADR 0008, rule 3). true when every project was written.
   */
  async function download(): Promise<boolean> {
    const projects = await fetchBody(
      LIST_PROJECTS_REQUEST,
      parseProjectList,
      'Sync download: GET /projects returned a body that is not a valid project list.',
    )
    if (projects === null) return false
    await store.replaceProjects(projects)
    // Species are written only with a project's snapshot: with no project, nothing to fetch.
    if (projects.length === 0) return true

    const species = await fetchBody(
      LIST_SPECIES_REQUEST,
      parseSpeciesList,
      'Sync download: GET /species returned a body that is not a valid species list.',
    )
    if (species === null) return false

    for (const project of projects) {
      const baitSites = await fetchBody(
        listBaitSitesRequest(project.id),
        (body) => parseBaitSiteList(body, project.id),
        'Sync download: GET of the bait sites returned a body that is not a valid bait site list.',
      )
      if (baitSites === null) return false
      const events = await fetchBody(
        listProjectEventsRequest(project.id),
        (body) => parseProjectEventList(body, project.id),
        'Sync download: GET of the project events returned a body that is not a valid event list.',
      )
      if (events === null) return false
      await store.replaceProjectSnapshot(project.id, { baitSites, events, species })
    }
    return true
  }

  async function sendableLeft(): Promise<boolean> {
    try {
      return sendableItems(await store.queuedItems()).length > 0
    } catch {
      logger.error('Sync: reading the queue after a pass failed.')
      return false
    }
  }

  /** Upload, then download: never both in flight (ADR 0008, decision 4). Never throws. */
  async function pass(): Promise<PassOutcome> {
    setStatus('uploading')
    let uploadFinished = false
    try {
      uploadFinished = (await upload()) === 'done'
      if (uploadFinished && downloadOwed) {
        // Cleared before it starts, so a 'full' request during the download owes another one.
        downloadOwed = false
        setStatus('downloading')
        let downloaded = false
        try {
          downloaded = await download()
        } finally {
          if (!downloaded) downloadOwed = true
        }
      }
    } catch (error) {
      // A store error (ConfirmationMismatchError, SnapshotMismatchError, a broken database)
      // or a programming error. Never its message: it may carry data.
      if (!(error instanceof Stopped)) logger.error('Sync: a pass stopped on an unexpected error.')
    }
    if (stopped) return { result: 'unavailable', sendableLeft: false }
    return {
      result: uploadFinished && !downloadOwed ? 'synced' : 'unavailable',
      sendableLeft: await sendableLeft(),
    }
  }

  async function run(): Promise<void> {
    disarmTimer()
    let outcome: PassOutcome
    try {
      do {
        runAgain = false
        outcome = await pass()
      } while (runAgain && !stopped)
    } finally {
      running = null
    }
    if (stopped) return
    setStatus('idle', outcome.result)
    // No timer with nothing to send: an owed download alone waits for the next trigger.
    if (outcome.sendableLeft) armTimer()
  }

  function requestSync(kind: 'upload' | 'full'): Promise<void> {
    if (stopped) return Promise.resolve()
    if (kind === 'full') downloadOwed = true
    if (running !== null) {
      runAgain = true
      return running
    }
    // Started on a microtask, so `running` is set before the first status change: a listener
    // that calls requestSync joins this run instead of starting a second one.
    running = Promise.resolve()
      .then(run)
      .catch(() => {
        // Only a listener can throw this far; requestSync never rejects.
        logger.error('Sync: a run stopped on an unexpected error.')
      })
    return running
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => status,
    requestSync,
    stop() {
      stopped = true
      disarmTimer()
    },
  }
}
