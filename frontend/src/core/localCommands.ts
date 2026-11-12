import type { LocalSession, SubmitOutcome } from './localSession'
import type { IdGenerator } from './ports'

// What the screens ask the local database to do (ADR 0008, decision 1). Domain ids are born
// here, never in ui, and the local session stays unaware of payload kinds. The id goes into
// the queue item, so every sync attempt reuses it (ADR 0002, rule 2): the client id is born
// once, at the first send.

export interface LocalCommands {
  /** Generates the project id and submits a createProject item. Rejects if submit rejects. */
  createProject(name: string): Promise<SubmitOutcome>
}

export function createLocalCommands(local: Pick<LocalSession, 'submit'>, ids: IdGenerator): LocalCommands {
  return {
    createProject(name) {
      // The name exactly as typed: the name rules live on the server.
      return local.submit({ kind: 'createProject', projectId: ids.newId(), name })
    },
  }
}
