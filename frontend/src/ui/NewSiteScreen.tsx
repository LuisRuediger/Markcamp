import { useEffect, useRef, useState, type FormEvent } from 'react'
import { betterReading } from '../core/geoReading'
import type { DateOutcome, LocalCommands } from '../core/localCommands'
import type { SubmitOutcome } from '../core/localSession'
import type { GeoFailure, GeoReading, GeolocationPort } from '../core/ports'
import { chosenInstant, type DateChoice } from './dateTime'
import DateTimeField from './DateTimeField'
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
  /** The site is in the queue: back to the screen where + was tapped. */
  onSaved: () => void
}

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
  const [saveFailure, setSaveFailure] = useState<'dateOutOfRange' | 'failed' | null>(null)
  const stopRef = useRef<(() => void) | null>(null)
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
    setSaveFailure(null)
    let outcome: SubmitOutcome | DateOutcome | 'failed'
    try {
      outcome = await commands.createBaitSite({
        projectId,
        // Exactly as typed: the name rules live on the server.
        name,
        latitude: reading.latitude,
        longitude: reading.longitude,
        locationAccuracyM: reading.accuracyM,
        // Closed or left empty: null, which is "now" at save time.
        occurredAt: chosenInstant(date),
      })
    } catch {
      outcome = 'failed'
    }
    // The user left with "Voltar" meanwhile: a late onSaved would pull them back.
    if (!mounted.current) return
    switch (outcome) {
      case 'queued':
        // Stopped at once, not only on unmount: the GPS is done.
        stopRef.current?.()
        onSaved()
        return
      // Anything else keeps everything on screen and says so.
      case 'dateOutOfRange':
        setSaveFailure('dateOutOfRange')
        break
      case 'notReady':
      case 'failed':
        setSaveFailure('failed')
        break
    }
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
        <DateTimeField value={date} onChange={setDate} />
        {/* No minimum accuracy: under canopy it may never get low. The number is on screen.
            Disabled while saving: a double tap would queue two sites with two ids. */}
        <button type="submit" disabled={best === null || saving}>
          {ptBR.sites.save}
        </button>
      </form>
      {saveFailure === 'dateOutOfRange' && <p role="alert">{ptBR.sites.dateOutOfRange}</p>}
      {saveFailure === 'failed' && <p role="alert">{ptBR.sites.saveFailed}</p>}
    </main>
  )
}

export default NewSiteScreen
