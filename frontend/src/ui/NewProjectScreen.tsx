import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { LocalCommands } from '../core/localCommands'
import type { SubmitOutcome } from '../core/localSession'
import { ptBR } from './i18n/pt-BR'

// A new project (decision T7 of slice F4-2a), opened by the + on Projetos. Its only write is
// commands.createProject. The command returns no id, so the new project is not opened: it
// shows on Projetos as "aguardando envio".

interface NewProjectScreenProps {
  commands: Pick<LocalCommands, 'createProject'>
  onBack: () => void
  /** The project is in the queue: back to Projetos. */
  onCreated: () => void
}

function NewProjectScreen({ commands, onBack, onCreated }: NewProjectScreenProps) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
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

  async function create() {
    setSaving(true)
    setSaveFailed(false)
    let outcome: SubmitOutcome | 'failed'
    try {
      // Exactly as typed: the name rules live on the server.
      outcome = await commands.createProject(name)
    } catch {
      outcome = 'failed'
    }
    // The user left with "Voltar" meanwhile: a late onCreated would pull them back.
    if (!mounted.current) return
    if (outcome === 'queued') {
      onCreated()
      return
    }
    // Anything else keeps the typed name and says so.
    setSaveFailed(true)
    setSaving(false)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!saving) void create()
  }

  return (
    <main className="page page--form">
      <button type="button" className="back-button" onClick={onBack}>
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        {ptBR.nav.back}
      </button>
      <h1 className="page__title">{ptBR.projects.newProject}</h1>

      <form className="page__form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field__label">{ptBR.projects.nameLabel}</span>
          {/* required only: the name rules (Unicode spaces, control characters, length in
              code points) belong to the server, and a copy here would drift. */}
          <input className="field__input" required value={name} onChange={(event) => setName(event.target.value)} />
        </label>
        {saveFailed && <p role="alert">{ptBR.projects.saveFailed}</p>}
        {/* Disabled while saving: a double tap would queue two projects with two ids. */}
        <button type="submit" className="primary-button" disabled={saving}>
          {ptBR.projects.create}
        </button>
      </form>
    </main>
  )
}

export default NewProjectScreen
