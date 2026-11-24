import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import type { LocalStore, QueueRejection } from '../core/localStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import type { Project } from '../core/project'
import { createReadyLocalSession } from './fakeLocalSession'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

function project(id: string, name: string): Project {
  return { id, name, role: 'OWNER', createdAt: '2026-11-07T12:00:00Z' }
}

/** Fills the fake LocalStore before the screen reads it, then renders the ready home screen. */
async function setup(prepare: (store: LocalStore) => Promise<void> = async () => {}) {
  const fakeStore = createFakeLocalStore()
  await prepare(fakeStore)
  const { projects, local } = createReadyLocalSession(fakeStore)
  const onOpenProject = vi.fn<(projectId: string) => void>()
  render(<HomeScreen local={local} projects={projects} onOpenProject={onOpenProject} />)
  return { local, onOpenProject }
}

/** Enqueues a createProject and rejects it; returns its seq. */
async function rejectedProject(store: LocalStore, projectId: string, name: string, rejection: QueueRejection) {
  const item = await store.enqueue({ kind: 'createProject', projectId, name })
  await store.markRejected(item.seq, rejection)
  return item.seq
}

async function row(name: string): Promise<HTMLElement> {
  const nameElement = await screen.findByText(name)
  const item = nameElement.closest('li')
  if (item === null) throw new Error(`no row for ${name}`)
  return item
}

function rowNames(): (string | null)[] {
  return within(screen.getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.firstElementChild?.textContent ?? null)
}

test('the page heading is "Projetos"; no email, Sair, sync status or create form', async () => {
  await setup()
  await screen.findByText(ptBR.projects.empty)

  expect(screen.getByRole('heading', { level: 1, name: ptBR.projects.title })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: ptBR.appTitle })).toBeNull()
  expect(screen.queryByText(ptBR.home.signedInAs('a@b.c'))).toBeNull()
  expect(screen.queryByRole('button', { name: ptBR.home.signOut })).toBeNull()
  expect(screen.queryByRole('status')).toBeNull()
  expect(screen.queryByRole('button', { name: ptBR.sync.syncNow })).toBeNull()
  expect(screen.queryByLabelText(ptBR.projects.nameLabel)).toBeNull()
  expect(screen.queryByRole('button', { name: ptBR.projects.create })).toBeNull()
})

describe('project list', () => {
  test('loading shows the loading line, then the empty state', async () => {
    await setup()

    expect(screen.getByText(ptBR.projects.loading)).toBeTruthy()
    expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('the empty text points at the +', async () => {
    await setup()

    expect(await screen.findByText('Nenhum projeto ainda. Toque em + para criar o primeiro.')).toBeTruthy()
  })

  test("a row's button is named by the project's name alone and opens it", async () => {
    const { onOpenProject } = await setup(async (store) => {
      await store.enqueue({ kind: 'createProject', projectId: 'p-2', name: 'Offline' })
    })

    fireEvent.click(await screen.findByRole('button', { name: 'Offline' }))

    expect(onOpenProject).toHaveBeenCalledExactlyOnceWith('p-2')
  })

  test("confirmed and queued projects come from the merge, in the view's order", async () => {
    await setup(async (store) => {
      await store.replaceProjects([project('p-3', 'Zona'), project('p-1', 'Apiário')])
      await store.enqueue({ kind: 'createProject', projectId: 'p-2', name: 'Offline' })
    })

    await screen.findByText('Offline')
    // The merge orders by id; the screen keeps that order.
    expect(rowNames()).toEqual(['Apiário', 'Offline', 'Zona'])
    expect(screen.queryByText(ptBR.projects.empty)).toBeNull()
  })

  test('a queued project shows the pending mark; a confirmed one does not', async () => {
    await setup(async (store) => {
      await store.replaceProjects([project('p-1', 'Apiário')])
      await store.enqueue({ kind: 'createProject', projectId: 'p-2', name: 'Offline' })
    })

    expect(within(await row('Offline')).getByText(ptBR.projects.pendingMark, { exact: false })).toBeTruthy()
    expect(within(await row('Apiário')).queryByText(ptBR.projects.pendingMark, { exact: false })).toBeNull()
  })
})

describe('rejected row', () => {
  test('VALIDATION_FAILED shows the name message; another code the generic one; no pending mark', async () => {
    await setup(async (store) => {
      await rejectedProject(store, 'p-1', 'Blank', { status: 400, code: 'VALIDATION_FAILED' })
      await rejectedProject(store, 'p-2', 'Other', { status: 409, code: 'ID_ALREADY_EXISTS' })
    })

    const blank = await row('Blank')
    expect(within(blank).getByText(ptBR.projects.rejectedName)).toBeTruthy()
    expect(within(blank).queryByText(ptBR.projects.pendingMark, { exact: false })).toBeNull()
    const other = await row('Other')
    expect(within(other).getByText(ptBR.projects.rejectedOther)).toBeTruthy()
    expect(within(other).queryByText(ptBR.projects.rejectedName)).toBeNull()
  })

  test("Tentar de novo calls retry with the item's seq", async () => {
    let seq = 0
    const { local } = await setup(async (store) => {
      await store.enqueue({ kind: 'createProject', projectId: 'p-0', name: 'Earlier' })
      seq = await rejectedProject(store, 'p-1', 'Blank', { status: 400, code: 'VALIDATION_FAILED' })
    })

    fireEvent.click(within(await row('Blank')).getByRole('button', { name: ptBR.retry }))

    expect(local.retry).toHaveBeenCalledExactlyOnceWith(seq)
    expect(seq).toBeGreaterThan(1)
  })

  test('Descartar alone does not discard; Confirmar descarte does; Cancelar goes back', async () => {
    let seq = 0
    const { local } = await setup(async (store) => {
      seq = await rejectedProject(store, 'p-1', 'Blank', { status: 400, code: 'VALIDATION_FAILED' })
    })
    const blank = await row('Blank')

    fireEvent.click(within(blank).getByRole('button', { name: ptBR.projects.discard }))
    expect(local.discard).not.toHaveBeenCalled()
    expect(within(blank).queryByRole('button', { name: ptBR.projects.discard })).toBeNull()

    fireEvent.click(within(blank).getByRole('button', { name: ptBR.projects.cancel }))
    expect(within(blank).queryByRole('button', { name: ptBR.projects.confirmDiscard })).toBeNull()
    expect(local.discard).not.toHaveBeenCalled()

    fireEvent.click(within(blank).getByRole('button', { name: ptBR.projects.discard }))
    fireEvent.click(within(blank).getByRole('button', { name: ptBR.projects.confirmDiscard }))
    expect(local.discard).toHaveBeenCalledExactlyOnceWith(seq)
  })

  test('a rejecting retry shows the alert', async () => {
    const { local } = await setup(async (store) => {
      await rejectedProject(store, 'p-1', 'Blank', { status: 400, code: 'VALIDATION_FAILED' })
    })
    local.retry.mockRejectedValue(new Error('write failed'))

    fireEvent.click(within(await row('Blank')).getByRole('button', { name: ptBR.retry }))

    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.projects.changeFailed)
  })

  test('a rejecting discard shows the alert', async () => {
    const { local } = await setup(async (store) => {
      await rejectedProject(store, 'p-1', 'Blank', { status: 400, code: 'VALIDATION_FAILED' })
    })
    local.discard.mockRejectedValue(new Error('write failed'))
    const blank = await row('Blank')

    fireEvent.click(within(blank).getByRole('button', { name: ptBR.projects.discard }))
    fireEvent.click(within(blank).getByRole('button', { name: ptBR.projects.confirmDiscard }))

    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.projects.changeFailed)
  })
})

test('a queued bait site does not mark its project as pending', async () => {
  await setup(async (store) => {
    await store.replaceProjects([project('p-1', 'Apiário')])
    await store.enqueue({
      kind: 'createBaitSite',
      projectId: 'p-1',
      baitSiteId: 's-1',
      name: 'Isca 1',
      latitude: -27.1,
      longitude: -49.1,
      locationAccuracyM: 5,
      installation: { id: 'e-1', occurredAt: instant('2026-11-12T10:00:00Z') },
    })
  })

  expect(within(await row('Apiário')).queryByText(ptBR.projects.pendingMark, { exact: false })).toBeNull()
})
