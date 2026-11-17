import { useState } from 'react'
import type { CommandOutcome } from '../core/localCommands'
import { ptBR } from './i18n/pt-BR'

// "Anular" on a history row (decision L5 of slice F3-3a), with a confirmation on the row like
// "Descartar". Who decides whether the void is possible is checkVoid inside the command, never
// this component. The caller keys the row by event id, so another event starts unconfirmed.

interface VoidActionsProps {
  /** Runs commands.voidEvent with the site of the view at the moment of the tap. */
  onVoid: () => Promise<CommandOutcome>
}

type Step = 'idle' | 'confirming' | 'voiding'

function VoidActions({ onVoid }: VoidActionsProps) {
  const [step, setStep] = useState<Step>('idle')
  const [failure, setFailure] = useState<'invalidSequence' | 'failed' | null>(null)

  async function confirm() {
    setStep('voiding')
    setFailure(null)
    let outcome: CommandOutcome | 'failed'
    try {
      outcome = await onVoid()
    } catch {
      // Includes voidEvent's throw for an event that is not in the history.
      outcome = 'failed'
    }
    switch (outcome) {
      case 'queued':
        // Nothing to do: the pending void hides the event from the view, so the row goes away.
        return
      case 'invalidSequence':
        setFailure('invalidSequence')
        break
      case 'notReady':
      case 'failed':
        setFailure('failed')
        break
    }
    setStep('idle')
  }

  return (
    <>
      {step === 'idle' ? (
        <button
          type="button"
          onClick={() => {
            setFailure(null)
            setStep('confirming')
          }}
        >
          {ptBR.sites.voidAction}
        </button>
      ) : (
        <>
          {/* Disabled while voiding: a double tap would queue two voids of the same event. */}
          <button type="button" disabled={step === 'voiding'} onClick={() => void confirm()}>
            {ptBR.sites.confirmVoid}
          </button>
          <button type="button" disabled={step === 'voiding'} onClick={() => setStep('idle')}>
            {ptBR.projects.cancel}
          </button>
        </>
      )}
      {failure === 'invalidSequence' && <p role="alert">{ptBR.sites.voidBlocked}</p>}
      {failure === 'failed' && <p role="alert">{ptBR.projects.changeFailed}</p>}
    </>
  )
}

export default VoidActions
