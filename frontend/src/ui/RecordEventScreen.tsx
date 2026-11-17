import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import type { RecordableType } from '../core/baitSiteRules'
import type { CommandOutcome, DateOutcome, LocalCommands, NewEvent } from '../core/localCommands'
import type { BaitSiteView, ProjectView } from '../core/localMerge'
import type { Observable } from '../core/localStore'
import { chosenInstant, type DateChoice } from './dateTime'
import DateTimeField from './DateTimeField'
import { ptBR } from './i18n/pt-BR'
import { speciesOptions } from './speciesOptions'

// One event of a chosen type for one bait site (decision L4 of slice F3-3a): its date and, for
// a capture, an optional species. Its only write is commands.recordEvent. IDENTIFIED is not a
// type here (slice F3-3b).

interface RecordEventScreenProps {
  projectId: string
  baitSiteId: string
  type: RecordableType
  /** From the local session's per-project cache, like the Site screen. */
  view: Observable<ProjectView>
  commands: Pick<LocalCommands, 'recordEvent'>
  onBack: () => void
  /** The event is in the queue: back to the Site screen. */
  onSaved: () => void
}

type Failure = 'invalidSequence' | 'dateOutOfRange' | 'failed'

const FAILURE_TEXT = {
  invalidSequence: ptBR.sites.invalidSequence,
  dateOutOfRange: ptBR.sites.dateOutOfRange,
  failed: ptBR.sites.saveFailed,
} satisfies Record<Failure, string>

function RecordEventScreen({ projectId, baitSiteId, type, view, commands, onBack, onSaved }: RecordEventScreenProps) {
  const snapshot = useSyncExternalStore(view.subscribe, view.getSnapshot)
  // '' = "Ainda não sei" = speciesId null.
  const [speciesId, setSpeciesId] = useState('')
  const [date, setDate] = useState<DateChoice>({ open: false })
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  // A save that ends after the screen closed changes nothing (decision L7 of slice F3-3a).
  // Set inside the effect, not only by useRef(true): StrictMode runs effects twice in
  // development, and the first cleanup would leave it false for good.
  const mounted = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function save(site: BaitSiteView) {
    setSaving(true)
    setFailure(null)
    // Narrowed by type, so the compiler refuses a species on anything but a capture.
    const event: NewEvent = type === 'CAPTURED' ? { type, speciesId: speciesId === '' ? null : speciesId } : { type }
    let outcome: CommandOutcome | DateOutcome | 'failed'
    try {
      outcome = await commands.recordEvent(projectId, site, { ...event, occurredAt: chosenInstant(date) })
    } catch {
      outcome = 'failed'
    }
    // The user left with "Voltar" meanwhile: a late onSaved would pull them back.
    if (!mounted.current) return
    switch (outcome) {
      case 'queued':
        onSaved()
        return
      // Anything else keeps everything on screen and says so.
      case 'invalidSequence':
      case 'dateOutOfRange':
        setFailure(outcome)
        break
      case 'notReady':
      case 'failed':
        setFailure('failed')
        break
    }
    setSaving(false)
  }

  function renderBody() {
    switch (snapshot.status) {
      case 'loading':
        return <p>{ptBR.sites.loadingSite}</p>
      case 'ready': {
        const { project, baitSites, species } = snapshot.value
        const site = project === null ? undefined : baitSites.find((candidate) => candidate.id === baitSiteId)
        if (project === null || site === undefined) return <h1>{ptBR.sites.siteNotFound}</h1>

        const handleSubmit = (event: FormEvent) => {
          event.preventDefault()
          // The site of this render: the view as it is at the tap, not when the screen opened.
          if (!saving) void save(site)
        }

        return (
          <>
            <h1>{ptBR.sites.recordTitles[type]}</h1>
            <p>{site.name}</p>
            <form onSubmit={handleSubmit}>
              {type === 'CAPTURED' && (
                <label>
                  {ptBR.sites.speciesLabel}
                  <select value={speciesId} onChange={(event) => setSpeciesId(event.target.value)}>
                    {/* First and selected by default: a missing species never blocks a capture (ADR 0005). */}
                    <option value="">{ptBR.sites.speciesUnknown}</option>
                    {speciesOptions(species).map((option) => (
                      <option key={option.id} value={option.id}>
                        {ptBR.sites.speciesOption(option.commonName, option.scientificName)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <DateTimeField value={date} onChange={setDate} />
              {/* Disabled while saving: a double tap would queue two events with two ids. */}
              <button type="submit" disabled={saving}>
                {ptBR.sites.save}
              </button>
            </form>
            {failure !== null && <p role="alert">{FAILURE_TEXT[failure]}</p>}
          </>
        )
      }
    }
  }

  return (
    <main>
      <button type="button" onClick={onBack}>
        {ptBR.nav.back}
      </button>
      {renderBody()}
    </main>
  )
}

export default RecordEventScreen
