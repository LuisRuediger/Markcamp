import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { createLocalCommands } from '../core/localCommands'
import type { SubmitOutcome } from '../core/localSession'
import type { LocalStore, QueueRejection } from '../core/localStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import type { Project } from '../core/project'
import { createReadyLocalSession } from './fakeLocalSession'
import { createFakeStore } from './fakeSessionStore'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'

const SESSION = { status: 'signedIn', email: 'a@b.c', backend: 'ok' } as const

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
  const { sync, projects, pendingCount, local } = createReadyLocalSession(fakeStore)
  let count = 0
  const commands = createLocalCommands(
    local,
    {
      newId: () => {
        count += 1
        return `new-${count}`
      },
    },
    () => new Date('2026-11-12T12:00:00Z'),
  )
  const session = createFakeStore(SESSION)
  render(
    <HomeScreen
      store={session}
      local={local}
      commands={commands}
      email="a@b.c"
      projects={projects}
      pendingCount={pendingCount}
      sync={sync}
    />,
  )
  return {
    session,
    sync,
    local,
    input: screen.getByLabelText<HTMLInputElement>(ptBR.projects.nameLabel),
    submit: screen.getByRole<HTMLButtonElement>('button', { name: ptBR.projects.create }),
  }
}

/** Enqueues a createProject and rejects it; returns its seq. */
async function rejectedProject(store: LocalStore, projectId: string, name: string, rejection: QueueRejection) {
  const item = await store.enqueue({ kind: 'createProject', projectId, name })
  await store.markRejected(item.seq, rejection)
  return item.seq
}

function typeAndSubmit(input: HTMLInputElement, submit: HTMLButtonElement, name: string) {
  fireEvent.change(input, { target: { value: name } })
  fireEvent.click(submit)
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

test('the email is shown and the backend line is gone', async () => {
  await setup()

  expect(screen.getByText(ptBR.home.signedInAs('a@b.c'))).toBeTruthy()
  expect(screen.queryByText('Conectado')).toBeNull()
  expect(screen.queryByText('Servidor indisponível no momento')).toBeNull()
})

test('Sair calls signOut', async () => {
  const { session } = await setup()

  fireEvent.click(screen.getByRole('button', { name: ptBR.home.signOut }))

  expect(session.signOut).toHaveBeenCalledOnce()
})

describe('project list', () => {
  test('loading shows the loading line, then the empty state', async () => {
    await setup()

    expect(screen.getByText(ptBR.projects.loading)).toBeTruthy()
    expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
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

describe('create form', () => {
  test('the input has required and no maxLength', async () => {
    const { input } = await setup()

    expect(input.required).toBe(true)
    expect(input.hasAttribute('maxlength')).toBe(false)
  })

  test('submit queues a createProject with the typed text and a new id', async () => {
    const { local, input, submit } = await setup()

    typeAndSubmit(input, submit, '  Sítio  ')

    expect(local.submit).toHaveBeenCalledExactlyOnceWith({ kind: 'createProject', projectId: 'new-1', name: '  Sítio  ' })
    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  test('the button is disabled while createProject is in flight', async () => {
    const { local, input, submit } = await setup()
    let finish: (outcome: SubmitOutcome) => void = () => {}
    local.submit.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    typeAndSubmit(input, submit, 'Sítio')
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(local.submit).toHaveBeenCalledOnce()

    finish('queued')
    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  test("'queued' clears the field and shows no alert", async () => {
    const { input, submit } = await setup()

    typeAndSubmit(input, submit, 'Sítio')

    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test("'notReady' shows the alert and keeps the name", async () => {
    const { local, input, submit } = await setup()
    local.submit.mockResolvedValue('notReady')

    typeAndSubmit(input, submit, 'Sítio')

    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.projects.saveFailed)
    expect(input.value).toBe('Sítio')
  })

  test('a rejected createProject shows the alert and keeps the name', async () => {
    const { local, input, submit } = await setup()
    local.submit.mockRejectedValue(new Error('enqueue failed'))

    typeAndSubmit(input, submit, 'Sítio')

    expect((await screen.findByRole('alert')).textContent).toBe(ptBR.projects.saveFailed)
    expect(input.value).toBe('Sítio')
    expect(submit.disabled).toBe(false)
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

describe('sync indicator', () => {
  test('each kind renders its text, driven through the fake engine', async () => {
    const { sync } = await setup()
    const status = () => screen.getByRole('status').textContent
    await screen.findByText(ptBR.projects.empty)

    expect(status()).toBe(ptBR.sync.synced)

    act(() => sync.setStatus({ phase: 'uploading', lastResult: 'synced' }))
    expect(status()).toBe(ptBR.sync.syncing)

    act(() => sync.setStatus({ phase: 'idle', lastResult: 'unavailable' }))
    expect(status()).toBe(ptBR.sync.offline)

    act(() => sync.setStatus({ phase: 'idle', lastResult: 'never' }))
    expect(status()).toBe(ptBR.sync.notYet)
  })

  test('with a pending project: never says synced, and offline adds the pending phrase', async () => {
    const { sync } = await setup(async (store) => {
      await store.enqueue({ kind: 'createProject', projectId: 'p-1', name: 'Offline' })
      await store.enqueue({ kind: 'createProject', projectId: 'p-2', name: 'Offline 2' })
    })
    await screen.findByText('Offline')
    const status = () => screen.getByRole('status').textContent

    expect(status()).toBe(ptBR.sync.pending(2))

    act(() => sync.setStatus({ phase: 'idle', lastResult: 'unavailable' }))
    expect(status()).toBe(`${ptBR.sync.offline}. ${ptBR.sync.pending(2)}`)
  })

  test('a queued bait site counts although no project is pending', async () => {
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
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('1 registro aguardando envio'))
  })

  test('a rejected item alone is not counted: synced', async () => {
    await setup(async (store) => {
      await rejectedProject(store, 'p-1', 'Blank', { status: 400, code: 'VALIDATION_FAILED' })
    })

    await row('Blank')
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(ptBR.sync.synced))
  })

  test('the pending phrase is singular for one', () => {
    expect(ptBR.sync.pending(1)).toBe('1 registro aguardando envio')
    expect(ptBR.sync.pending(3)).toBe('3 registros aguardando envio')
  })

  test("Sincronizar agora requests 'full' and is disabled while a pass runs", async () => {
    const { sync } = await setup()
    const button = screen.getByRole<HTMLButtonElement>('button', { name: ptBR.sync.syncNow })

    fireEvent.click(button)
    expect(sync.requestSync).toHaveBeenCalledExactlyOnceWith('full')

    act(() => sync.setStatus({ phase: 'downloading', lastResult: 'synced' }))
    expect(button.disabled).toBe(true)

    act(() => sync.setStatus({ phase: 'idle', lastResult: 'synced' }))
    expect(button.disabled).toBe(false)
  })
})
