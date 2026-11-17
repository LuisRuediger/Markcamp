import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { RecordableType } from '../core/baitSiteRules'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import type { CommandOutcome, DateOutcome, LocalCommands } from '../core/localCommands'
import { createProjectViewCache } from '../core/localMerge'
import type { LocalSpecies, LocalStore } from '../core/localStore'
import { ptBR } from './i18n/pt-BR'
import RecordEventScreen from './RecordEventScreen'

const P = 'p-1'

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

// Out of order on purpose: the picker orders by common name.
const SPECIES: LocalSpecies[] = [
  { id: 'sp-mandacaia', scientificName: 'Melipona quadrifasciata', commonName: 'Mandaçaia' },
  { id: 'sp-jatai', scientificName: 'Tetragonisca angustula', commonName: 'Jataí' },
  { id: 'sp-bora', scientificName: 'Tetragona clavipes', commonName: 'Borá' },
]

/** Project "Apiário" with site s-1 "Isca 1", armed on 2026-11-03. */
async function armedSite(store: LocalStore, species: LocalSpecies[] = SPECIES) {
  await store.replaceProjects([{ id: P, name: 'Apiário', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
  await store.replaceProjectSnapshot(P, {
    baitSites: [{ id: 's-1', projectId: P, name: 'Isca 1', latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-03T12:00:00Z' }],
    events: [
      {
        id: 'e-1',
        projectId: P,
        baitSiteId: 's-1',
        type: 'INSTALLED',
        occurredAt: instant('2026-11-03T10:00:00Z'),
        speciesId: null,
        identifiedEventId: null,
        recordedAt: '2026-11-03T12:00:00Z',
      },
    ],
    species,
  })
}

async function setup(type: RecordableType, prepare: (store: LocalStore) => Promise<void> = armedSite) {
  const store = createFakeLocalStore()
  await prepare(store)
  const recordEvent = vi.fn<LocalCommands['recordEvent']>(async () => 'queued')
  const onBack = vi.fn<() => void>()
  const onSaved = vi.fn<() => void>()
  const { unmount } = render(
    <RecordEventScreen
      projectId={P}
      baitSiteId="s-1"
      type={type}
      view={createProjectViewCache(store)(P)}
      commands={{ recordEvent }}
      onBack={onBack}
      onSaved={onSaved}
    />,
  )
  await screen.findByRole('heading', { name: ptBR.sites.recordTitles[type] })
  return {
    store,
    recordEvent,
    onBack,
    onSaved,
    unmount,
    save: () => screen.getByRole<HTMLButtonElement>('button', { name: ptBR.sites.save }),
    species: () => screen.getByLabelText<HTMLSelectElement>(ptBR.sites.speciesLabel),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

test('loading, then the title for the type and the site name', async () => {
  const store = createFakeLocalStore()
  await armedSite(store)
  render(
    <RecordEventScreen
      projectId={P}
      baitSiteId="s-1"
      type="INSPECTED"
      view={createProjectViewCache(store)(P)}
      commands={{ recordEvent: vi.fn() }}
      onBack={() => {}}
      onSaved={() => {}}
    />,
  )

  expect(screen.getByText(ptBR.sites.loadingSite)).toBeTruthy()
  expect(await screen.findByRole('heading', { name: 'Registrar inspeção' })).toBeTruthy()
  expect(screen.getByText('Isca 1')).toBeTruthy()
})

test('an unknown site: "Ponto não encontrado" and Voltar', async () => {
  const store = createFakeLocalStore()
  const onBack = vi.fn<() => void>()
  render(
    <RecordEventScreen
      projectId={P}
      baitSiteId="s-9"
      type="INSPECTED"
      view={createProjectViewCache(store)(P)}
      commands={{ recordEvent: vi.fn() }}
      onBack={onBack}
      onSaved={() => {}}
    />,
  )

  expect(await screen.findByRole('heading', { name: ptBR.sites.siteNotFound })).toBeTruthy()
  expect(screen.queryByRole('button', { name: ptBR.sites.save })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: ptBR.nav.back }))
  expect(onBack).toHaveBeenCalledOnce()
})

describe('species', () => {
  test('no picker for anything but a capture; the event has only its type', async () => {
    const t = await setup('INSPECTED')

    expect(screen.queryByLabelText(ptBR.sites.speciesLabel)).toBeNull()
    fireEvent.click(t.save())

    expect(t.recordEvent).toHaveBeenCalledOnce()
    const [projectId, site, event] = t.recordEvent.mock.calls[0] ?? []
    expect([projectId, site?.id]).toEqual([P, 's-1'])
    expect(event).toEqual({ type: 'INSPECTED', occurredAt: null })
  })

  test('"Ainda não sei" first and selected; then every species by common name', async () => {
    const t = await setup('CAPTURED')

    expect(t.species().value).toBe('')
    expect([...t.species().options].map((option) => option.textContent)).toEqual([
      ptBR.sites.speciesUnknown,
      'Borá (Tetragona clavipes)',
      'Jataí (Tetragonisca angustula)',
      'Mandaçaia (Melipona quadrifasciata)',
    ])
  })

  test('left at "Ainda não sei": speciesId null; the date link closed: occurredAt null', async () => {
    const t = await setup('CAPTURED')

    fireEvent.click(t.save())

    expect(t.recordEvent.mock.calls[0]?.[2]).toEqual({ type: 'CAPTURED', speciesId: null, occurredAt: null })
  })

  test('a chosen species: its id', async () => {
    const t = await setup('CAPTURED')

    fireEvent.change(t.species(), { target: { value: 'sp-jatai' } })
    fireEvent.click(t.save())

    expect(t.recordEvent.mock.calls[0]?.[2]).toEqual({ type: 'CAPTURED', speciesId: 'sp-jatai', occurredAt: null })
  })

  test('no species synced: only "Ainda não sei"', async () => {
    const t = await setup('CAPTURED', (store) => armedSite(store, []))

    expect([...t.species().options].map((option) => option.textContent)).toEqual([ptBR.sites.speciesUnknown])
  })
})

describe('Salvar', () => {
  test('the date link opened and filled gives the converted instant', async () => {
    const t = await setup('INSPECTED')

    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.changeDate }))
    fireEvent.change(screen.getByLabelText(ptBR.sites.dateLabel), { target: { value: '2026-11-05T08:15' } })
    fireEvent.click(t.save())

    expect(t.recordEvent.mock.calls[0]?.[2].occurredAt).toBe(toHistoryInstant(new Date(2026, 10, 5, 8, 15).toISOString()))
  })

  test("'queued' calls onSaved", async () => {
    const t = await setup('INSPECTED')

    fireEvent.click(t.save())

    await waitFor(() => expect(t.onSaved).toHaveBeenCalledOnce())
  })

  test.each<[string, () => Promise<CommandOutcome | DateOutcome>, string]>([
    ["'invalidSequence'", async () => 'invalidSequence', ptBR.sites.invalidSequence],
    ["'dateOutOfRange'", async () => 'dateOutOfRange', ptBR.sites.dateOutOfRange],
    ["'notReady'", async () => 'notReady', ptBR.sites.saveFailed],
    [
      'a rejected promise',
      async () => {
        throw new Error('enqueue failed')
      },
      ptBR.sites.saveFailed,
    ],
  ])('%s: its alert, everything kept, Salvar enabled again', async (_name, outcome, text) => {
    const t = await setup('CAPTURED')
    t.recordEvent.mockImplementation(outcome)
    fireEvent.change(t.species(), { target: { value: 'sp-jatai' } })
    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.changeDate }))
    fireEvent.change(screen.getByLabelText(ptBR.sites.dateLabel), { target: { value: '2026-11-05T08:15' } })

    fireEvent.click(t.save())

    expect((await screen.findByRole('alert')).textContent).toBe(text)
    expect(t.onSaved).not.toHaveBeenCalled()
    expect(t.species().value).toBe('sp-jatai')
    expect(screen.getByLabelText<HTMLInputElement>(ptBR.sites.dateLabel).value).toBe('2026-11-05T08:15')
    expect(t.save().disabled).toBe(false)
  })

  test('disabled while recordEvent is in flight: a double tap records one event', async () => {
    const t = await setup('INSPECTED')
    let finish: (outcome: CommandOutcome) => void = () => {}
    t.recordEvent.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    fireEvent.click(t.save())
    expect(t.save().disabled).toBe(true)
    fireEvent.click(t.save())
    expect(t.recordEvent).toHaveBeenCalledOnce()

    finish('notReady')
    await waitFor(() => expect(t.save().disabled).toBe(false))
  })
})

describe('a result that arrives after the screen closed (decision L7)', () => {
  async function savedThenClosed() {
    const t = await setup('INSPECTED')
    let finish: (outcome: CommandOutcome) => void = () => {}
    t.recordEvent.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    fireEvent.click(t.save())
    t.unmount()
    return { ...t, finish }
  }

  test("'queued': onSaved is not called", async () => {
    const t = await savedThenClosed()

    await act(async () => t.finish('queued'))

    expect(t.onSaved).not.toHaveBeenCalled()
  })

  test("'notReady': no alert and no React warning", async () => {
    const consoleError = vi.spyOn(console, 'error')
    const t = await savedThenClosed()

    await act(async () => t.finish('notReady'))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(consoleError).not.toHaveBeenCalled()
    expect(t.onSaved).not.toHaveBeenCalled()
  })
})
