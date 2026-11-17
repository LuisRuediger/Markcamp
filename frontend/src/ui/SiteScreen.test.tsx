import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BaitSiteEventType } from '../core/baitSiteStateMachine'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import { createLocalCommands, type CommandOutcome, type DateOutcome, type LocalCommands } from '../core/localCommands'
import { createProjectViewCache } from '../core/localMerge'
import type { LocalBaitSite, LocalEvent, LocalSpecies, LocalStore, QueuePayload } from '../core/localStore'
import { createFakeLocalSession } from './fakeLocalSession'
import { ptBR } from './i18n/pt-BR'
import SiteScreen from './SiteScreen'

const P = 'p-1'
const REJECTION = { status: 409, code: 'INVALID_EVENT_SEQUENCE' } as const
const JATAI: LocalSpecies = { id: 'sp-jatai', scientificName: 'Tetragonisca angustula', commonName: 'Jataí' }
const MANDACAIA: LocalSpecies = { id: 'sp-mandacaia', scientificName: 'Melipona quadrifasciata', commonName: 'Mandaçaia' }
const BORA: LocalSpecies = { id: 'sp-bora', scientificName: 'Tetragona clavipes', commonName: 'Borá' }
// Out of order on purpose: the picker orders by common name.
const SPECIES: LocalSpecies[] = [MANDACAIA, JATAI, BORA]

/** A local date and time as a history instant: the expected texts hold in any time zone. */
function local(month: number, day: number, hour = 10, minute = 0): HistoryInstant {
  const instant = toHistoryInstant(new Date(2026, month - 1, day, hour, minute).toISOString())
  if (instant === null) throw new Error('not an instant')
  return instant
}

function site(id: string, name: string): LocalBaitSite {
  return { id, projectId: P, name, latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' }
}

function event(id: string, type: BaitSiteEventType, occurredAt: HistoryInstant, speciesId: string | null = null): LocalEvent {
  return { id, projectId: P, baitSiteId: 's-1', type, occurredAt, speciesId, identifiedEventId: null, recordedAt: '2026-11-20T12:00:00Z' }
}

function recordEvent(eventId: string, type: BaitSiteEventType, occurredAt: HistoryInstant): QueuePayload {
  return { kind: 'recordEvent', projectId: P, baitSiteId: 's-1', eventId, type, occurredAt, speciesId: null, identifiedEventId: null }
}

/** Project "Apiário" with site s-1 "Isca 1" and these confirmed events. */
async function confirmedSite(store: LocalStore, events: LocalEvent[], species: LocalSpecies[] = [JATAI]) {
  await store.replaceProjects([{ id: P, name: 'Apiário', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
  await store.replaceProjectSnapshot(P, { baitSites: [site('s-1', 'Isca 1')], events, species })
}

// INSTALLED 03/11, ACTIVITY 09/11, CAPTURED 10/11 (Jataí): status CAPTURED.
const CAPTURED_HISTORY = [
  event('e-1', 'INSTALLED', local(11, 3)),
  event('e-2', 'ACTIVITY', local(11, 9)),
  event('e-3', 'CAPTURED', local(11, 10), JATAI.id),
]

async function rejected(store: LocalStore, payload: QueuePayload): Promise<number> {
  const item = await store.enqueue(payload)
  await store.markRejected(item.seq, REJECTION)
  return item.seq
}

interface SetupOptions {
  baitSiteId?: string
  /** The commands to use; by default voidEvent and recordEvent spies that resolve 'queued'. */
  commands?: (store: LocalStore) => Pick<LocalCommands, 'voidEvent' | 'recordEvent'>
}

async function setup(prepare: (store: LocalStore) => Promise<void>, options: SetupOptions = {}) {
  const store = createFakeLocalStore()
  await prepare(store)
  const session = createFakeLocalSession()
  const voidEvent = vi.fn<LocalCommands['voidEvent']>(async () => 'queued')
  const recordEvent = vi.fn<LocalCommands['recordEvent']>(async () => 'queued')
  const onBack = vi.fn<() => void>()
  const onRecord = vi.fn<(type: string) => void>()
  render(
    <SiteScreen
      projectId={P}
      baitSiteId={options.baitSiteId ?? 's-1'}
      view={createProjectViewCache(store)(P)}
      local={session}
      commands={options.commands?.(store) ?? { voidEvent, recordEvent }}
      onBack={onBack}
      onRecord={onRecord}
    />,
  )
  return { store, local: session, voidEvent, recordEvent, onBack, onRecord }
}

/** The history rows' descriptions, top to bottom (the void buttons left out). */
function historyTexts(): string[] {
  return screen.getAllByRole('listitem').map((item) => item.querySelector('span')?.textContent ?? '')
}

async function historyRow(text: string): Promise<HTMLElement> {
  const item = (await screen.findByText(text)).closest('li')
  if (item === null) throw new Error(`no row for ${text}`)
  return item
}

const TYPE_LABELS = new Set<string>(Object.values(ptBR.sites.eventTypes))

/** The labels of the type buttons on screen, in order. */
function typeButtons(): string[] {
  return screen
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((label) => TYPE_LABELS.has(label))
}

describe('the site', () => {
  test('loading, then the name, the status line and the history newest first, with the species', async () => {
    await setup((store) => confirmedSite(store, CAPTURED_HISTORY))

    expect(screen.getByText(ptBR.sites.loadingSite)).toBeTruthy()
    expect(await screen.findByRole('heading', { name: 'Isca 1' })).toBeTruthy()
    expect(screen.getByText('Capturada · desde 10/11')).toBeTruthy()
    expect(historyTexts()).toEqual(['Captura · 10/11, 10:00 · Jataí', 'Atividade · 09/11, 10:00', 'Instalação · 03/11, 10:00'])
  })

  test('a pending event: its row and the status line say "aguardando envio"', async () => {
    await setup(async (store) => {
      await confirmedSite(store, [event('e-1', 'INSTALLED', local(11, 3))])
      await store.enqueue(recordEvent('e-2', 'INSPECTED', local(11, 5, 8, 30)))
    })

    expect(await screen.findByText('Inspeção · 05/11, 08:30 · aguardando envio')).toBeTruthy()
    expect(screen.getByText('Armada · desde 05/11 · aguardando envio')).toBeTruthy()
  })

  test('a species that is not in the catalogue: no name', async () => {
    await setup((store) =>
      confirmedSite(store, [event('e-1', 'INSTALLED', local(11, 3)), event('e-2', 'CAPTURED', local(11, 4), 'sp-unknown')], []),
    )

    expect(await screen.findByText('Captura · 04/11, 10:00')).toBeTruthy()
  })

  test('every event voided: "Nenhum registro"', async () => {
    await setup(async (store) => {
      await confirmedSite(store, [event('e-1', 'INSTALLED', local(11, 3))])
      await store.enqueue({ kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-1' })
    })

    expect(await screen.findByText(ptBR.sites.emptyHistory)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('an unknown site: "Ponto não encontrado", Voltar, nothing else', async () => {
    const { onBack } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY), { baitSiteId: 's-9' })

    expect(await screen.findByRole('heading', { name: ptBR.sites.siteNotFound })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: ptBR.sites.historyHeading })).toBeNull()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: ptBR.nav.back }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  test('a project that is gone, its site still in the copy: "Ponto não encontrado"', async () => {
    await setup(async (store) => {
      await store.replaceProjectSnapshot(P, { baitSites: [site('s-1', 'Isca 1')], events: [event('e-1', 'INSTALLED', local(11, 3))], species: [] })
    })

    expect(await screen.findByRole('heading', { name: ptBR.sites.siteNotFound })).toBeTruthy()
    expect(screen.queryByText('Isca 1')).toBeNull()
  })
})

describe('Registrar', () => {
  test('a CAPTURED site: the recordable types, never "Identificação"; a tap opens Record with its type', async () => {
    const { onRecord } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY))
    await screen.findByRole('heading', { name: ptBR.sites.recordHeading })

    expect(typeButtons()).toEqual(['Perda', 'Coleta', 'Inspeção'])
    expect(screen.queryByRole('button', { name: ptBR.sites.eventTypes.IDENTIFIED })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Perda' }))
    expect(onRecord).toHaveBeenCalledExactlyOnceWith('LOST')
  })

  test('a site rejection: its text and actions, the blocked sentence, no type buttons, no Anular', async () => {
    let seq = 0
    const { local: session } = await setup(async (store) => {
      await confirmedSite(store, CAPTURED_HISTORY)
      seq = await rejected(store, recordEvent('e-4', 'INSPECTED', local(11, 12, 15, 30)))
    })

    expect(await screen.findByText('O servidor recusou o registro: Inspeção de 12/11, 15:30')).toBeTruthy()
    expect(screen.getByText(ptBR.sites.siteBlocked)).toBeTruthy()
    expect(typeButtons()).toEqual([])
    expect(screen.queryByRole('button', { name: ptBR.sites.voidAction })).toBeNull()
    // The status line drops the pending mark next to a rejection, like the Project row.
    expect(screen.getByText('Capturada · desde 12/11')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: ptBR.retry }))
    expect(session.retry).toHaveBeenCalledExactlyOnceWith(seq)
  })

  test('a project rejection: the project sentence, no type buttons, no Anular', async () => {
    await setup(async (store) => {
      await rejected(store, { kind: 'createProject', projectId: P, name: 'Recusado' })
      await store.enqueue({
        kind: 'createBaitSite',
        projectId: P,
        baitSiteId: 's-1',
        name: 'Isca 1',
        latitude: -27.2,
        longitude: -49.2,
        locationAccuracyM: 8,
        installation: { id: 'e-1', occurredAt: local(11, 12) },
      })
    })

    expect(await screen.findByText(ptBR.sites.projectRejected)).toBeTruthy()
    expect(screen.queryByText(ptBR.sites.siteBlocked)).toBeNull()
    expect(typeButtons()).toEqual([])
    expect(screen.queryByRole('button', { name: ptBR.sites.voidAction })).toBeNull()
  })

  test('an invalid history: no type buttons and no sentence, but Anular is there', async () => {
    await setup((store) => confirmedSite(store, [event('e-1', 'INSTALLED', local(11, 3)), event('e-2', 'LOST', local(11, 4))]))

    expect(await screen.findByText('Histórico inválido · desde 04/11')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: ptBR.sites.recordHeading })).toBeNull()
    expect(typeButtons()).toEqual([])
    expect(screen.queryByText(ptBR.sites.siteBlocked)).toBeNull()
    expect(screen.queryByText(ptBR.sites.projectRejected)).toBeNull()
    expect(screen.getAllByRole('button', { name: ptBR.sites.voidAction })).toHaveLength(2)
  })
})

describe('Anular', () => {
  const top = () => historyRow('Captura · 10/11, 10:00 · Jataí')

  test('needs the confirmation, then calls voidEvent with the site of the view and the event id', async () => {
    const { voidEvent } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY))
    const row = await top()

    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.voidAction }))
    expect(voidEvent).not.toHaveBeenCalled()
    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.confirmVoid }))

    expect(voidEvent).toHaveBeenCalledOnce()
    const [projectId, voidedSite, eventId] = voidEvent.mock.calls[0] ?? []
    expect([projectId, voidedSite?.id, eventId]).toEqual([P, 's-1', 'e-3'])
  })

  test('Cancelar goes back to Anular without voiding', async () => {
    const { voidEvent } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY))
    const row = await top()

    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.voidAction }))
    fireEvent.click(within(row).getByRole('button', { name: ptBR.projects.cancel }))

    expect(within(row).getByRole('button', { name: ptBR.sites.voidAction })).toBeTruthy()
    expect(within(row).queryByRole('button', { name: ptBR.sites.confirmVoid })).toBeNull()
    expect(voidEvent).not.toHaveBeenCalled()
  })

  test.each<[string, () => Promise<CommandOutcome>, string]>([
    ["'invalidSequence'", async () => 'invalidSequence', ptBR.sites.voidBlocked],
    ["'notReady'", async () => 'notReady', ptBR.projects.changeFailed],
    [
      'a rejected promise',
      async () => {
        throw new Error('enqueue failed')
      },
      ptBR.projects.changeFailed,
    ],
  ])('%s: its text on that row only, and Anular again', async (_name, outcome, text) => {
    const { voidEvent } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY))
    voidEvent.mockImplementation(outcome)
    const row = await top()

    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.voidAction }))
    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.confirmVoid }))

    expect((await within(row).findByRole('alert')).textContent).toBe(text)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(within(row).getByRole('button', { name: ptBR.sites.voidAction })).toBeTruthy()
  })

  test('Confirmar anulação is disabled while the void is running', async () => {
    const { voidEvent } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY))
    let finish: (outcome: CommandOutcome) => void = () => {}
    voidEvent.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const row = await top()

    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.voidAction }))
    const confirm = within(row).getByRole<HTMLButtonElement>('button', { name: ptBR.sites.confirmVoid })
    fireEvent.click(confirm)
    expect(confirm.disabled).toBe(true)
    fireEvent.click(confirm)
    expect(voidEvent).toHaveBeenCalledOnce()

    await act(async () => finish('invalidSequence'))
    expect(within(row).getByRole('button', { name: ptBR.sites.voidAction })).toBeTruthy()
  })

  test('with the real commands over the fake store: a confirmed void removes the row and the status follows', async () => {
    await setup((store) => confirmedSite(store, CAPTURED_HISTORY), {
      commands: (store) =>
        createLocalCommands(
          {
            submit: async (payload) => {
              await store.enqueue(payload)
              return 'queued'
            },
          },
          { newId: () => 'id-1' },
          () => new Date('2026-11-12T12:00:00Z'),
        ),
    })
    const row = await top()

    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.voidAction }))
    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.confirmVoid }))

    await waitFor(() => expect(historyTexts()).toEqual(['Atividade · 09/11, 10:00', 'Instalação · 03/11, 10:00']))
    expect(screen.getByText('Com atividade · desde 09/11 · aguardando envio')).toBeTruthy()
  })
})

function identified(id: string, captureId: string, speciesId: string, occurredAt: HistoryInstant): LocalEvent {
  return { ...event(id, 'IDENTIFIED', occurredAt, speciesId), identifiedEventId: captureId }
}

// Two cycles, a capture in each: INSTALLED 03/11, CAPTURED 04/11 (no species), COLLECTED 05/11,
// INSTALLED 06/11, CAPTURED 07/11 (Jataí). Status CAPTURED.
const TWO_CYCLES = [
  event('e-1', 'INSTALLED', local(11, 3)),
  event('e-2', 'CAPTURED', local(11, 4)),
  event('e-3', 'COLLECTED', local(11, 5)),
  event('e-4', 'INSTALLED', local(11, 6)),
  event('e-5', 'CAPTURED', local(11, 7), JATAI.id),
]

/** The real commands over the fake store: ids id-1, id-2…, the clock at 12/11 12:00 local. */
function realCommands(store: LocalStore) {
  let next = 0
  return createLocalCommands(
    {
      submit: async (payload) => {
        await store.enqueue(payload)
        return 'queued'
      },
    },
    { newId: () => `id-${++next}` },
    () => new Date(2026, 10, 12, 12, 0),
  )
}

const identifyButton = (row: HTMLElement) => within(row).queryByRole('button', { name: ptBR.sites.identifyAction })

/** The descriptions of the rows that offer "Identificar espécie", top to bottom. */
function rowsWithIdentify(): string[] {
  return screen
    .getAllByRole('listitem')
    .filter((item) => identifyButton(item) !== null)
    .map((item) => item.querySelector('span')?.textContent ?? '')
}

describe('Identificar espécie: where it is offered', () => {
  test('every capture row of two cycles, and no other row', async () => {
    await setup((store) => confirmedSite(store, TWO_CYCLES))
    await screen.findByText('Captura · 07/11, 10:00 · Jataí')

    expect(rowsWithIdentify()).toEqual(['Captura · 07/11, 10:00 · Jataí', 'Captura · 04/11, 10:00'])
  })

  test.each<[string, LocalEvent[], string]>([
    ['EMPTY after the capture was collected', TWO_CYCLES.slice(0, 3), 'Vazia · desde 05/11'],
    ['ARMED again in a new cycle', TWO_CYCLES.slice(0, 4), 'Armada · desde 06/11'],
  ])('a capture of an earlier cycle, the site %s', async (_name, events, status) => {
    await setup((store) => confirmedSite(store, events))

    expect(await screen.findByText(status)).toBeTruthy()
    expect(rowsWithIdentify()).toEqual(['Captura · 04/11, 10:00'])
  })

  test('a pending capture', async () => {
    await setup(async (store) => {
      await confirmedSite(store, [event('e-1', 'INSTALLED', local(11, 3))])
      await store.enqueue(recordEvent('e-2', 'CAPTURED', local(11, 4)))
    })
    await screen.findByText('Captura · 04/11, 10:00 · aguardando envio')

    expect(rowsWithIdentify()).toEqual(['Captura · 04/11, 10:00 · aguardando envio'])
  })

  test('an identified capture: not offered (N1-b), on neither row; Anular still on both', async () => {
    await setup((store) =>
      confirmedSite(store, [...CAPTURED_HISTORY, identified('e-4', 'e-3', MANDACAIA.id, local(11, 11))], SPECIES),
    )
    const identification = await historyRow('Identificação · 11/11, 10:00 · Mandaçaia · captura de 10/11')
    const capture = await historyRow('Captura · 10/11, 10:00 · Mandaçaia')

    expect(screen.queryByRole('button', { name: ptBR.sites.identifyAction })).toBeNull()
    expect(within(identification).getByRole('button', { name: ptBR.sites.voidAction })).toBeTruthy()
    expect(within(capture).getByRole('button', { name: ptBR.sites.voidAction })).toBeTruthy()
  })

  test('a capture with its own species and no identification: offered (identifying corrects it)', async () => {
    await setup((store) => confirmedSite(store, CAPTURED_HISTORY))
    await screen.findByText('Captura · 10/11, 10:00 · Jataí')

    expect(rowsWithIdentify()).toEqual(['Captura · 10/11, 10:00 · Jataí'])
  })

  test('hidden with a site rejection', async () => {
    await setup(async (store) => {
      await confirmedSite(store, CAPTURED_HISTORY)
      await rejected(store, recordEvent('e-4', 'INSPECTED', local(11, 12, 15, 30)))
    })
    await screen.findByText(ptBR.sites.siteBlocked)

    expect(screen.getByText('Captura · 10/11, 10:00 · Jataí')).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.sites.identifyAction })).toBeNull()
  })

  test('hidden with a project rejection', async () => {
    await setup(async (store) => {
      await rejected(store, { kind: 'createProject', projectId: P, name: 'Recusado' })
      await store.enqueue({
        kind: 'createBaitSite',
        projectId: P,
        baitSiteId: 's-1',
        name: 'Isca 1',
        latitude: -27.2,
        longitude: -49.2,
        locationAccuracyM: 8,
        installation: { id: 'e-1', occurredAt: local(11, 3) },
      })
      await store.enqueue(recordEvent('e-2', 'CAPTURED', local(11, 4)))
    })
    await screen.findByText(ptBR.sites.projectRejected)

    expect(screen.getByText('Captura · 04/11, 10:00 · aguardando envio')).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.sites.identifyAction })).toBeNull()
  })

  test('hidden with an invalid history, where Anular is still there', async () => {
    await setup((store) =>
      confirmedSite(store, [event('e-1', 'INSTALLED', local(11, 3)), event('e-2', 'LOST', local(11, 4)), event('e-3', 'CAPTURED', local(11, 5))]),
    )
    await screen.findByText('Histórico inválido · desde 05/11')

    const capture = await historyRow('Captura · 05/11, 10:00')
    expect(within(capture).getByRole('button', { name: ptBR.sites.voidAction })).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.sites.identifyAction })).toBeNull()
  })
})

describe('Identificar espécie: the picker', () => {
  const older = () => historyRow('Captura · 04/11, 10:00')

  async function opened(prepare: (store: LocalStore) => Promise<void> = (store) => confirmedSite(store, TWO_CYCLES, SPECIES)) {
    const t = await setup(prepare)
    const row = await older()
    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.identifyAction }))
    return {
      ...t,
      row,
      select: () => within(row).getByLabelText<HTMLSelectElement>(ptBR.sites.speciesLabel),
      save: () => within(row).getByRole<HTMLButtonElement>('button', { name: ptBR.sites.save }),
      cancel: () => within(row).getByRole<HTMLButtonElement>('button', { name: ptBR.projects.cancel }),
    }
  }

  test('opens with "Escolha a espécie" and Salvar disabled; the species by common name, no "Ainda não sei"', async () => {
    const t = await opened()

    expect(identifyButton(t.row)).toBeNull()
    expect(t.select().value).toBe('')
    expect(t.save().disabled).toBe(true)
    expect([...t.select().options].map((option) => [option.value, option.textContent])).toEqual([
      ['', ptBR.sites.chooseSpecies],
      ['sp-bora', 'Borá (Tetragona clavipes)'],
      ['sp-jatai', 'Jataí (Tetragonisca angustula)'],
      ['sp-mandacaia', 'Mandaçaia (Melipona quadrifasciata)'],
    ])
    expect(screen.queryByText(ptBR.sites.speciesUnknown)).toBeNull()
  })

  test('no species synced: only "Escolha a espécie", Salvar stays disabled', async () => {
    const t = await opened((store) => confirmedSite(store, TWO_CYCLES, []))

    expect([...t.select().options].map((option) => option.textContent)).toEqual([ptBR.sites.chooseSpecies])
    expect(t.save().disabled).toBe(true)
  })

  test('choose + Salvar: an IDENTIFIED of the tapped capture (not the latest), dated now; queued closes it', async () => {
    const t = await opened()

    fireEvent.change(t.select(), { target: { value: 'sp-bora' } })
    expect(t.save().disabled).toBe(false)
    fireEvent.click(t.save())

    expect(t.recordEvent).toHaveBeenCalledOnce()
    const [projectId, identifiedSite, newEvent] = t.recordEvent.mock.calls[0] ?? []
    expect([projectId, identifiedSite?.id]).toEqual([P, 's-1'])
    expect(newEvent).toEqual({ type: 'IDENTIFIED', speciesId: 'sp-bora', identifiedEventId: 'e-2', occurredAt: null })
    await waitFor(() => expect(identifyButton(t.row)).toBeTruthy())
    expect(within(t.row).queryByLabelText(ptBR.sites.speciesLabel)).toBeNull()
    expect(t.voidEvent).not.toHaveBeenCalled()
  })

  test.each<[string, () => Promise<CommandOutcome | DateOutcome>, string]>([
    ["'invalidSequence'", async () => 'invalidSequence', ptBR.sites.identifyFailed],
    ["'dateOutOfRange'", async () => 'dateOutOfRange', ptBR.sites.dateOutOfRange],
    ["'notReady'", async () => 'notReady', ptBR.sites.saveFailed],
    [
      'a rejected promise',
      async () => {
        throw new Error('enqueue failed')
      },
      ptBR.sites.saveFailed,
    ],
  ])('%s: its text on that row only; still open, chosen, Salvar enabled', async (_name, outcome, text) => {
    const t = await opened()
    t.recordEvent.mockImplementation(outcome)

    fireEvent.change(t.select(), { target: { value: 'sp-jatai' } })
    fireEvent.click(t.save())

    expect((await within(t.row).findByRole('alert')).textContent).toBe(text)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(t.select().value).toBe('sp-jatai')
    expect(t.save().disabled).toBe(false)
  })

  test('Salvar and Cancelar disabled while saving: a double tap records one identification', async () => {
    const t = await opened()
    let finish: (outcome: CommandOutcome) => void = () => {}
    t.recordEvent.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    fireEvent.change(t.select(), { target: { value: 'sp-jatai' } })
    fireEvent.click(t.save())
    expect(t.save().disabled).toBe(true)
    expect(t.cancel().disabled).toBe(true)
    fireEvent.click(t.save())
    expect(t.recordEvent).toHaveBeenCalledOnce()

    await act(async () => finish('notReady'))
    expect(t.save().disabled).toBe(false)
    expect(t.cancel().disabled).toBe(false)
  })

  test('Cancelar goes back to the link without recording; it opens again with nothing chosen', async () => {
    const t = await opened()

    fireEvent.change(t.select(), { target: { value: 'sp-jatai' } })
    fireEvent.click(t.cancel())

    expect(within(t.row).queryByLabelText(ptBR.sites.speciesLabel)).toBeNull()
    expect(t.recordEvent).not.toHaveBeenCalled()
    fireEvent.click(within(t.row).getByRole('button', { name: ptBR.sites.identifyAction }))
    expect(t.select().value).toBe('')
  })
})

describe('Identificar espécie with the real commands over the fake store', () => {
  // The identification is dated by the commands' clock: 12/11 12:00 local.
  test.each<[string, LocalEvent[], string, string, string]>([
    [
      'a capture without species',
      [event('e-1', 'INSTALLED', local(11, 3)), event('e-2', 'CAPTURED', local(11, 10))],
      'Captura · 10/11, 10:00',
      'sp-jatai',
      'Jataí',
    ],
    ['a capture with its own species', CAPTURED_HISTORY, 'Captura · 10/11, 10:00 · Jataí', 'sp-mandacaia', 'Mandaçaia'],
  ])('%s: identified, the species shows and the link goes; the identification voided, both come back', async (_name, events, before, chosen, name) => {
    await setup((store) => confirmedSite(store, events, SPECIES), { commands: realCommands })
    const capture = await historyRow(before)

    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.identifyAction }))
    fireEvent.change(within(capture).getByLabelText(ptBR.sites.speciesLabel), { target: { value: chosen } })
    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.save }))

    const identification = `Identificação · 12/11, 12:00 · ${name} · captura de 10/11 · aguardando envio`
    await waitFor(() => expect(historyTexts().slice(0, 2)).toEqual([identification, `Captura · 10/11, 10:00 · ${name}`]))
    expect(rowsWithIdentify()).toEqual([])

    const row = await historyRow(identification)
    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.voidAction }))
    fireEvent.click(within(row).getByRole('button', { name: ptBR.sites.confirmVoid }))

    await waitFor(() => expect(historyTexts()[0]).toBe(before))
    expect(screen.queryByText(identification)).toBeNull()
    expect(rowsWithIdentify()).toEqual([before])
  })

  test('a LOST does not bring the link back to the identified capture; the new capture has its own', async () => {
    const { store } = await setup(
      (store) =>
        confirmedSite(
          store,
          [event('e-1', 'INSTALLED', local(11, 3)), event('e-2', 'CAPTURED', local(11, 4))],
          SPECIES,
        ),
      { commands: realCommands },
    )
    const capture = await historyRow('Captura · 04/11, 10:00')
    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.identifyAction }))
    fireEvent.change(within(capture).getByLabelText(ptBR.sites.speciesLabel), { target: { value: JATAI.id } })
    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.save }))
    await screen.findByText('Captura · 04/11, 10:00 · Jataí')
    expect(rowsWithIdentify()).toEqual([])

    // After the identification (dated 12/11 12:00 by the commands' clock), so the LOST and the new capture are later.
    await act(async () => {
      await store.enqueue(recordEvent('e-8', 'LOST', local(11, 13)))
    })
    await screen.findByText('Perda · 13/11, 10:00 · aguardando envio')
    expect(rowsWithIdentify()).toEqual([])

    await act(async () => {
      await store.enqueue(recordEvent('e-9', 'CAPTURED', local(11, 14)))
    })
    await screen.findByText('Captura · 14/11, 10:00 · aguardando envio')
    expect(rowsWithIdentify()).toEqual(['Captura · 14/11, 10:00 · aguardando envio'])
  })

  test('Anular on a capture that has an identification: the void is refused with voidBlocked', async () => {
    const { store } = await setup(
      (store) => confirmedSite(store, [...CAPTURED_HISTORY, identified('e-4', 'e-3', MANDACAIA.id, local(11, 11))], SPECIES),
      { commands: realCommands },
    )
    const capture = await historyRow('Captura · 10/11, 10:00 · Mandaçaia')

    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.voidAction }))
    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.confirmVoid }))

    expect((await within(capture).findByRole('alert')).textContent).toBe(ptBR.sites.voidBlocked)
    expect(await store.queuedItems()).toEqual([])
  })
})

describe('the site at the moment of the tap (N5)', () => {
  test('Identificar espécie: recordEvent gets the site as it is at Salvar, not when the picker opened', async () => {
    const { store, recordEvent: spy } = await setup((store) => confirmedSite(store, CAPTURED_HISTORY, SPECIES))
    const capture = await historyRow('Captura · 10/11, 10:00 · Jataí')
    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.identifyAction }))

    await act(async () => {
      await store.enqueue(recordEvent('e-9', 'INSPECTED', local(11, 11)))
    })
    await screen.findByText('Inspeção · 11/11, 10:00 · aguardando envio')

    fireEvent.change(within(capture).getByLabelText(ptBR.sites.speciesLabel), { target: { value: 'sp-bora' } })
    fireEvent.click(within(capture).getByRole('button', { name: ptBR.sites.save }))

    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]?.[1].events.map((candidate) => candidate.id)).toEqual(['e-1', 'e-2', 'e-3', 'e-9'])
  })
})
