import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BaitSiteEventType } from '../core/baitSiteStateMachine'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import { createLocalCommands, type CommandOutcome, type LocalCommands } from '../core/localCommands'
import { createProjectViewCache } from '../core/localMerge'
import type { LocalBaitSite, LocalEvent, LocalSpecies, LocalStore, QueuePayload } from '../core/localStore'
import { createFakeLocalSession } from './fakeLocalSession'
import { ptBR } from './i18n/pt-BR'
import SiteScreen from './SiteScreen'

const P = 'p-1'
const REJECTION = { status: 409, code: 'INVALID_EVENT_SEQUENCE' } as const
const JATAI: LocalSpecies = { id: 'sp-jatai', scientificName: 'Tetragonisca angustula', commonName: 'Jataí' }

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
  /** The commands to use; by default a voidEvent spy that resolves 'queued'. */
  commands?: (store: LocalStore) => Pick<LocalCommands, 'voidEvent'>
}

async function setup(prepare: (store: LocalStore) => Promise<void>, options: SetupOptions = {}) {
  const store = createFakeLocalStore()
  await prepare(store)
  const session = createFakeLocalSession()
  const voidEvent = vi.fn<LocalCommands['voidEvent']>(async () => 'queued')
  const onBack = vi.fn<() => void>()
  const onRecord = vi.fn<(type: string) => void>()
  render(
    <SiteScreen
      projectId={P}
      baitSiteId={options.baitSiteId ?? 's-1'}
      view={createProjectViewCache(store)(P)}
      local={session}
      commands={options.commands?.(store) ?? { voidEvent }}
      onBack={onBack}
      onRecord={onRecord}
    />,
  )
  return { store, local: session, voidEvent, onBack, onRecord }
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
