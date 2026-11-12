import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import type { BaitSiteEventType } from '../core/baitSiteStateMachine'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import { createProjectViewCache } from '../core/localMerge'
import type { LocalBaitSite, LocalEvent, LocalStore, QueuePayload } from '../core/localStore'
import { createFakeLocalSession } from './fakeLocalSession'
import { ptBR } from './i18n/pt-BR'
import ProjectScreen from './ProjectScreen'

const P = 'p-1'
const REJECTION = { status: 409, code: 'INVALID_EVENT_SEQUENCE' } as const

/** A local date and time as a history instant: the expected texts hold in any time zone. */
function local(month: number, day: number, hour = 10, minute = 0): HistoryInstant {
  const instant = toHistoryInstant(new Date(2026, month - 1, day, hour, minute).toISOString())
  if (instant === null) throw new Error('not an instant')
  return instant
}

function site(id: string, name: string): LocalBaitSite {
  return { id, projectId: P, name, latitude: -27.1, longitude: -49.1, locationAccuracyM: 5, createdAt: '2026-11-01T12:00:00Z' }
}

function event(id: string, baitSiteId: string, type: BaitSiteEventType, occurredAt: HistoryInstant): LocalEvent {
  return { id, projectId: P, baitSiteId, type, occurredAt, speciesId: null, identifiedEventId: null, recordedAt: '2026-11-20T12:00:00Z' }
}

function createSite(baitSiteId: string, name: string, occurredAt: HistoryInstant): QueuePayload {
  return {
    kind: 'createBaitSite',
    projectId: P,
    baitSiteId,
    name,
    latitude: -27.2,
    longitude: -49.2,
    locationAccuracyM: 8,
    installation: { id: `${baitSiteId}-installed`, occurredAt },
  }
}

function recordEvent(baitSiteId: string, eventId: string, type: BaitSiteEventType, occurredAt: HistoryInstant): QueuePayload {
  return { kind: 'recordEvent', projectId: P, baitSiteId, eventId, type, occurredAt, speciesId: null, identifiedEventId: null }
}

async function confirmedProject(store: LocalStore, sites: LocalBaitSite[] = [], events: LocalEvent[] = []) {
  await store.replaceProjects([{ id: P, name: 'Apiário', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
  await store.replaceProjectSnapshot(P, { baitSites: sites, events, species: [] })
}

async function rejected(store: LocalStore, payload: QueuePayload): Promise<number> {
  const item = await store.enqueue(payload)
  await store.markRejected(item.seq, REJECTION)
  return item.seq
}

async function setup(prepare: (store: LocalStore) => Promise<void> = async () => {}) {
  const store = createFakeLocalStore()
  await prepare(store)
  const session = createFakeLocalSession()
  const onBack = vi.fn<() => void>()
  const onNewSite = vi.fn<(suggestedName: string) => void>()
  render(<ProjectScreen view={createProjectViewCache(store)(P)} local={session} onBack={onBack} onNewSite={onNewSite} />)
  return { local: session, onBack, onNewSite }
}

async function row(name: string): Promise<HTMLElement> {
  const item = (await screen.findByText(name)).closest('li')
  if (item === null) throw new Error(`no row for ${name}`)
  return item
}

function rowTexts(): string[] {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '')
}

test('loading, then the project name as the title', async () => {
  await setup(confirmedProject)

  expect(screen.getByText(ptBR.sites.loading)).toBeTruthy()
  expect(await screen.findByRole('heading', { name: 'Apiário' })).toBeTruthy()
})

test("rows in the view's order with name, status and the date of the last event", async () => {
  await setup(async (store) => {
    // Names in the opposite order of the ids: the screen keeps the id order.
    await confirmedProject(
      store,
      [site('s-1', 'Zeta'), site('s-2', 'Alfa')],
      [
        event('e-1', 's-1', 'INSTALLED', local(11, 3)),
        event('e-2', 's-2', 'INSTALLED', local(11, 4)),
        event('e-3', 's-2', 'ACTIVITY', local(11, 9)),
        event('e-4', 's-2', 'CAPTURED', local(11, 10)),
      ],
    )
    await store.enqueue(createSite('s-3', 'Isca nova', local(11, 12)))
  })

  await screen.findByText('Isca nova')
  expect(rowTexts()).toEqual([
    'Zeta · Armada · desde 03/11',
    'Alfa · Capturada · desde 10/11',
    'Isca nova · Armada · desde 12/11 · aguardando envio',
  ])
})

test('a site with no event left shows its status and no date', async () => {
  await setup(async (store) => {
    await confirmedProject(store, [site('s-1', 'Isca 1')], [event('e-1', 's-1', 'INSTALLED', local(11, 3))])
    await store.enqueue({ kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-1' })
  })

  expect((await row('Isca 1')).textContent).toBe('Isca 1 · Vazia · aguardando envio')
})

test('a confirmed site with only a pending event shows the pending mark', async () => {
  await setup(async (store) => {
    await confirmedProject(store, [site('s-1', 'Isca 1')], [event('e-1', 's-1', 'INSTALLED', local(11, 3))])
    await store.enqueue(recordEvent('s-1', 'e-2', 'ACTIVITY', local(11, 5)))
  })

  expect((await row('Isca 1')).textContent).toBe('Isca 1 · Com atividade · desde 05/11 · aguardando envio')
})

describe('rejected site', () => {
  test('createBaitSite: its text and no pending mark', async () => {
    await setup(async (store) => {
      await confirmedProject(store)
      await rejected(store, createSite('s-1', 'Isca 1', local(11, 12)))
    })

    const item = await row('Isca 1')
    expect(within(item).getByText(ptBR.sites.rejectedSite)).toBeTruthy()
    expect(item.textContent).not.toContain(ptBR.sites.pendingMark)
  })

  test('recordEvent: names the type and the local date and time; no pending mark', async () => {
    await setup(async (store) => {
      await confirmedProject(store, [site('s-1', 'Isca 1')], [event('e-1', 's-1', 'INSTALLED', local(11, 3))])
      await rejected(store, recordEvent('s-1', 'e-2', 'ACTIVITY', local(11, 12, 15, 30)))
    })

    const item = await row('Isca 1')
    expect(within(item).getByText('O servidor recusou o registro: Atividade de 12/11, 15:30')).toBeTruthy()
    expect(item.textContent).not.toContain(ptBR.sites.pendingMark)
  })

  test('voidEvent of a confirmed event: names that event', async () => {
    await setup(async (store) => {
      await confirmedProject(
        store,
        [site('s-1', 'Isca 1')],
        [event('e-1', 's-1', 'INSTALLED', local(11, 3)), event('e-2', 's-1', 'CAPTURED', local(11, 13, 8, 5))],
      )
      await rejected(store, { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-2' })
    })

    expect(within(await row('Isca 1')).getByText('O servidor recusou a anulação: Captura de 13/11, 08:05')).toBeTruthy()
  })

  test('an event that is nowhere: the generic text', async () => {
    await setup(async (store) => {
      await confirmedProject(store, [site('s-1', 'Isca 1')], [event('e-1', 's-1', 'INSTALLED', local(11, 3))])
      await rejected(store, { kind: 'voidEvent', projectId: P, baitSiteId: 's-1', eventId: 'e-gone' })
    })

    expect(within(await row('Isca 1')).getByText(ptBR.sites.rejectedUnknown)).toBeTruthy()
  })

  test("Tentar de novo calls retry with the item's seq", async () => {
    let seq = 0
    const { local: session } = await setup(async (store) => {
      await confirmedProject(store)
      await store.enqueue({ kind: 'createProject', projectId: 'p-other', name: 'Earlier' })
      seq = await rejected(store, createSite('s-1', 'Isca 1', local(11, 12)))
    })

    fireEvent.click(within(await row('Isca 1')).getByRole('button', { name: ptBR.retry }))

    expect(session.retry).toHaveBeenCalledExactlyOnceWith(seq)
    expect(seq).toBeGreaterThan(1)
  })

  test('Descartar needs the confirmation, then calls discard with the seq', async () => {
    let seq = 0
    const { local: session } = await setup(async (store) => {
      await confirmedProject(store)
      seq = await rejected(store, createSite('s-1', 'Isca 1', local(11, 12)))
    })
    const item = await row('Isca 1')

    fireEvent.click(within(item).getByRole('button', { name: ptBR.projects.discard }))
    expect(session.discard).not.toHaveBeenCalled()
    fireEvent.click(within(item).getByRole('button', { name: ptBR.projects.confirmDiscard }))

    expect(session.discard).toHaveBeenCalledExactlyOnceWith(seq)
  })
})

test('a project that is gone: "Projeto não encontrado", Voltar, nothing else', async () => {
  const { onBack } = await setup()

  expect(await screen.findByRole('heading', { name: ptBR.sites.projectNotFound })).toBeTruthy()
  expect(screen.queryByRole('button', { name: ptBR.sites.newSite })).toBeNull()
  expect(screen.queryByText(ptBR.sites.empty)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: ptBR.nav.back }))
  expect(onBack).toHaveBeenCalledOnce()
})

test('an empty project: "Nenhum ponto ainda" and no list', async () => {
  await setup(confirmedProject)

  expect(await screen.findByText(ptBR.sites.empty)).toBeTruthy()
  expect(screen.queryByRole('list')).toBeNull()
})

describe('Novo ponto', () => {
  test('opens New site with the suggested name, computed from the sites on screen', async () => {
    const { onNewSite } = await setup(async (store) => {
      await confirmedProject(store, [site('s-1', 'Isca 1')], [event('e-1', 's-1', 'INSTALLED', local(11, 3))])
      await store.enqueue(createSite('s-2', 'Isca 2', local(11, 4)))
    })
    await screen.findByText('Isca 2')

    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.newSite }))

    expect(onNewSite).toHaveBeenCalledExactlyOnceWith('Isca 3')
  })

  test('hidden in a rejected project, with the text that says why', async () => {
    await setup(async (store) => {
      await rejected(store, { kind: 'createProject', projectId: P, name: 'Recusado' })
    })

    expect(await screen.findByText(ptBR.sites.projectRejected)).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.sites.newSite })).toBeNull()
  })

  test('shown in a project that is only pending', async () => {
    await setup(async (store) => {
      await store.enqueue({ kind: 'createProject', projectId: P, name: 'Offline' })
    })

    expect(await screen.findByRole('button', { name: ptBR.sites.newSite })).toBeTruthy()
    expect(screen.queryByText(ptBR.sites.projectRejected)).toBeNull()
  })
})
