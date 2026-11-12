import { useEffect, useRef, useState, type FormEvent } from 'react'
import { betterReading } from '../core/geoReading'
import type { LocalCommands } from '../core/localCommands'
import type { SubmitOutcome } from '../core/localSession'
import type { GeoFailure, GeoReading, GeolocationPort } from '../core/ports'
import { fromLocalInputValue, toLocalInputValue } from './dateTime'
import { ptBR } from './i18n/pt-BR'

// A new bait site from the phone's GPS (decision K5 of slice F3-2). The GPS runs only while
// this screen is open: the permission prompt and the battery cost come only when the user
// means to create a site. Its only write is commands.createBaitSite.

interface NewSiteScreenProps {
  projectId: string
  /** "Isca N", computed once when the screen was opened. */
  suggestedName: string
  geolocation: GeolocationPort
  commands: Pick<LocalCommands, 'createBaitSite'>
  onBack: () => void
  /** The site is in the queue: back to the Project screen. */
  onSaved: () => void
}

/** The date link: closed (now, at save time) or open with what was typed. */
type DateChoice = { readonly open: false } | { readonly open: true; readonly max: string; readonly value: string }

function GpsLine({ best, failure }: { best: GeoReading | null; failure: GeoFailure | null }) {
  switch (failure) {
    case 'denied':
      return <p role="alert">{ptBR.sites.locationDenied}</p>
    case 'unsupported':
      return <p role="alert">{ptBR.sites.locationUnsupported}</p>
    case 'unavailable':
    case null:
      // Once there is a reading, 'unavailable' changes nothing: the best one is still good.
      if (best !== null) return <p>{ptBR.sites.accuracy(Math.round(best.accuracyM))}</p>
      return <p>{failure === 'unavailable' ? ptBR.sites.noSignal : ptBR.sites.searching}</p>
  }
}

function NewSiteScreen({ projectId, suggestedName, geolocation, commands, onBack, onSaved }: NewSiteScreenProps) {
  // The best reading so far, never the latest: a worse fix later must not move the site.
  const [best, setBest] = useState<GeoReading | null>(null)
  const [failure, setFailure] = useState<GeoFailure | null>(null)
  const [name, setName] = useState(suggestedName)
  const [date, setDate] = useState<DateChoice>({ open: false })
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const stopRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const stop = geolocation.watch(
      (reading) => setBest((current) => betterReading(current, reading)),
      (next) => setFailure(next),
    )
    stopRef.current = stop
    return () => {
      stopRef.current = null
      stop()
    }
  }, [geolocation])

  async function save(reading: GeoReading) {
    setSaving(true)
    setSaveFailed(false)
    let outcome: SubmitOutcome | 'failed'
    try {
      outcome = await commands.createBaitSite({
        projectId,
        // Exactly as typed: the name rules live on the server.
        name,
        latitude: reading.latitude,
        longitude: reading.longitude,
        locationAccuracyM: reading.accuracyM,
        // Closed or left empty: null, which is "now" at save time.
        occurredAt: date.open ? fromLocalInputValue(date.value) : null,
      })
    } catch {
      outcome = 'failed'
    }
    if (outcome === 'queued') {
      // Stopped at once, not only on unmount: the GPS is done.
      stopRef.current?.()
      onSaved()
      return
    }
    // Anything else keeps everything on screen and says so.
    setSaveFailed(true)
    setSaving(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (best !== null && !saving) void save(best)
  }

  return (
    <main>
      <button type="button" onClick={onBack}>
        {ptBR.nav.back}
      </button>
      <h1>{ptBR.sites.newSite}</h1>
      <GpsLine best={best} failure={failure} />

      <form onSubmit={handleSubmit}>
        <label>
          {ptBR.sites.nameLabel}
          {/* required only: the name rules belong to the server, and a copy here would drift. */}
          <input required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {date.open ? (
          <>
            <label>
              {ptBR.sites.dateLabel}
              {/* max = now when it was opened: occurredAt may not be in the future (ADR 0005, rule 2). */}
              <input
                type="datetime-local"
                max={date.max}
                value={date.value}
                onChange={(event) => setDate({ ...date, value: event.target.value })}
              />
            </label>
            <button type="button" onClick={() => setDate({ open: false })}>
              {ptBR.sites.useNow}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setDate({ open: true, max: toLocalInputValue(new Date()), value: '' })}>
            {ptBR.sites.changeDate}
          </button>
        )}
        {/* No minimum accuracy: under canopy it may never get low. The number is on screen.
            Disabled while saving: a double tap would queue two sites with two ids. */}
        <button type="submit" disabled={best === null || saving}>
          {ptBR.sites.save}
        </button>
      </form>
      {saveFailed && <p role="alert">{ptBR.sites.saveFailed}</p>}
    </main>
  )
}

export default NewSiteScreen
