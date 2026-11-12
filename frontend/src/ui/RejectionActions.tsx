import { useState } from 'react'
import type { LocalSession } from '../core/localSession'
import { ptBR } from './i18n/pt-BR'

// A rejected queue item on its row (decision E5 of slice F2c): what was refused, "retry" and
// "discard" with a confirmation. Shared by the project row and the bait site row.

interface RejectionActionsProps {
  /** What the server refused, already in words. */
  text: string
  /** The rejected item. The caller keys this component by it, so a new item starts unconfirmed. */
  seq: number
  local: Pick<LocalSession, 'retry' | 'discard'>
}

function RejectionActions({ text, seq, local }: RejectionActionsProps) {
  const [confirming, setConfirming] = useState(false)
  const [failed, setFailed] = useState(false)

  async function change(action: () => Promise<void>) {
    setFailed(false)
    try {
      await action()
    } catch {
      setFailed(true)
    }
  }

  return (
    <>
      <p>{text}</p>
      <button
        type="button"
        onClick={() => {
          setConfirming(false)
          void change(() => local.retry(seq))
        }}
      >
        {ptBR.retry}
      </button>
      {/* Discarding deletes the record for good: a second tap on the row confirms it. */}
      {confirming ? (
        <>
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              void change(() => local.discard(seq))
            }}
          >
            {ptBR.projects.confirmDiscard}
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            {ptBR.projects.cancel}
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          {ptBR.projects.discard}
        </button>
      )}
      {failed && <p role="alert">{ptBR.projects.changeFailed}</p>}
    </>
  )
}

export default RejectionActions
