import { useState } from 'react'
import type { CommandOutcome, DateOutcome } from '../core/localCommands'
import type { LocalSpecies } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'
import { speciesOptions } from './speciesOptions'

// "Identificar espécie" on a capture row without a valid identification (decisions N1 and N1-b
// of slice F3-3b; the caller decides when to show it): a species picker that opens on the
// row, like the confirmation of "Anular". Who decides whether the identification
// is possible is checkNewEvent inside recordEvent, never this component. The caller keys the
// row by event id, so another capture starts closed. No date: an identification is dated now
// (decision N2).

interface IdentifyActionsProps {
  /** The catalogue as the view has it; the picker shows it in speciesOptions order. */
  species: readonly LocalSpecies[]
  /** Runs commands.recordEvent for this capture with the site of the view at the moment of the tap. */
  onIdentify: (speciesId: string) => Promise<CommandOutcome | DateOutcome>
}

type Step = 'idle' | 'choosing' | 'saving'

type Failure = 'invalidSequence' | 'dateOutOfRange' | 'failed'

const FAILURE_TEXT = {
  invalidSequence: ptBR.sites.identifyFailed,
  dateOutOfRange: ptBR.sites.dateOutOfRange,
  failed: ptBR.sites.saveFailed,
} satisfies Record<Failure, string>

function IdentifyActions({ species, onIdentify }: IdentifyActionsProps) {
  const [step, setStep] = useState<Step>('idle')
  // '' = nothing chosen yet. There is no "Ainda não sei": an IDENTIFIED requires a species.
  const [speciesId, setSpeciesId] = useState('')
  const [failure, setFailure] = useState<Failure | null>(null)

  async function save() {
    setStep('saving')
    setFailure(null)
    let outcome: CommandOutcome | DateOutcome | 'failed'
    try {
      outcome = await onIdentify(speciesId)
    } catch {
      outcome = 'failed'
    }
    switch (outcome) {
      case 'queued':
        // Back to the link: the capture row shows the new species by itself, from the view.
        setStep('idle')
        return
      // Anything else keeps the picker open with the choice, and says so on the row.
      case 'invalidSequence':
      case 'dateOutOfRange':
        setFailure(outcome)
        break
      case 'notReady':
      case 'failed':
        setFailure('failed')
        break
    }
    setStep('choosing')
  }

  if (step === 'idle') {
    return (
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setSpeciesId('')
          setFailure(null)
          setStep('choosing')
        }}
      >
        {ptBR.sites.identifyAction}
      </button>
    )
  }

  const saving = step === 'saving'
  return (
    <div className="identify">
      <label>
        {ptBR.sites.speciesLabel}
        <select value={speciesId} onChange={(event) => setSpeciesId(event.target.value)}>
          <option value="">{ptBR.sites.chooseSpecies}</option>
          {speciesOptions(species).map((option) => (
            <option key={option.id} value={option.id}>
              {ptBR.sites.speciesOption(option.commonName, option.scientificName)}
            </option>
          ))}
        </select>
      </label>
      {/* Disabled while saving: a double tap would queue two identifications with two ids. */}
      <button type="button" disabled={saving || speciesId === ''} onClick={() => void save()}>
        {ptBR.sites.save}
      </button>
      <button type="button" disabled={saving} onClick={() => setStep('idle')}>
        {ptBR.projects.cancel}
      </button>
      {failure !== null && <p role="alert">{FAILURE_TEXT[failure]}</p>}
    </div>
  )
}

export default IdentifyActions
