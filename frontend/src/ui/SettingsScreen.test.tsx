import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import type { LocalStore } from '../core/localStore'
import { createReadyLocalSession } from './fakeLocalSession'
import { createFakeStore } from './fakeSessionStore'
import { ptBR } from './i18n/pt-BR'
import SettingsScreen from './SettingsScreen'

const SESSION = { status: 'signedIn', email: 'a@b.c', backend: 'ok' } as const

function instant(value: string): HistoryInstant {
  const result = toHistoryInstant(value)
  if (result === null) throw new Error(`not an instant: ${value}`)
  return result
}

/** Fills the fake LocalStore before the screen reads it, then renders Ajustes. */
async function setup(prepare: (store: LocalStore) => Promise<void> = async () => {}, email: string | null = 'a@b.c') {
  const fakeStore = createFakeLocalStore()
  await prepare(fakeStore)
  const { sync, pendingCount } = createReadyLocalSession(fakeStore)
  const session = createFakeStore(SESSION)
  render(<SettingsScreen store={session} email={email} pendingCount={pendingCount} sync={sync} appVersion="abc1234" />)
  return { session, sync }
}

const status = () => screen.getByRole('status').textContent
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })
const queryButton = (name: string) => screen.queryByRole('button', { name })

test('the title and both section headings', async () => {
  await setup()

  expect(screen.getByRole('heading', { level: 1, name: ptBR.settings.title })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: ptBR.settings.syncSection })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: ptBR.settings.accountSection })).toBeTruthy()
})

test('the email is shown and the backend line is gone', async () => {
  await setup()

  expect(screen.getByText(ptBR.home.signedInAs('a@b.c'))).toBeTruthy()
  expect(screen.queryByText('Conectado')).toBeNull()
  expect(screen.queryByText('Servidor indisponível no momento')).toBeNull()
})

test('without an email: "Você entrou"', async () => {
  await setup(async () => {}, null)

  expect(screen.getByText(ptBR.home.signedIn)).toBeTruthy()
})

test('the version comes from the prop', async () => {
  await setup()

  expect(screen.getByText('Versão abc1234')).toBeTruthy()
})

describe('sign-out, confirmed on the row', () => {
  test('Sair does not sign out: it shows the warning, Confirmar saída and Cancelar', async () => {
    const { session } = await setup()

    fireEvent.click(button(ptBR.home.signOut))

    expect(session.signOut).not.toHaveBeenCalled()
    expect(screen.getByText(ptBR.settings.signOutWarning)).toBeTruthy()
    expect(button(ptBR.settings.confirmSignOut)).toBeTruthy()
    expect(button(ptBR.settings.cancel)).toBeTruthy()
    expect(queryButton(ptBR.home.signOut)).toBeNull()
    // A warning before a choice, not an error.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('Confirmar saída calls signOut once', async () => {
    const { session } = await setup()

    fireEvent.click(button(ptBR.home.signOut))
    fireEvent.click(button(ptBR.settings.confirmSignOut))

    expect(session.signOut).toHaveBeenCalledOnce()
  })

  test('Cancelar brings Sair back and calls nothing', async () => {
    const { session } = await setup()

    fireEvent.click(button(ptBR.home.signOut))
    fireEvent.click(button(ptBR.settings.cancel))

    expect(button(ptBR.home.signOut)).toBeTruthy()
    expect(screen.queryByText(ptBR.settings.signOutWarning)).toBeNull()
    expect(queryButton(ptBR.settings.confirmSignOut)).toBeNull()
    expect(session.signOut).not.toHaveBeenCalled()
  })
})

describe('sync indicator', () => {
  test('each kind renders its text, driven through the fake engine', async () => {
    const { sync } = await setup()

    await waitFor(() => expect(status()).toBe(ptBR.sync.synced))

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

    // The engine's last pass was synced (the fake's default): the pending count wins (H4).
    await waitFor(() => expect(status()).toBe(ptBR.sync.pending(2)))

    act(() => sync.setStatus({ phase: 'idle', lastResult: 'unavailable' }))
    expect(status()).toBe(`${ptBR.sync.offline}. ${ptBR.sync.pending(2)}`)
  })

  test('a queued bait site counts although no project is pending', async () => {
    await setup(async (store) => {
      await store.replaceProjects([{ id: 'p-1', name: 'Apiário', role: 'OWNER', createdAt: '2026-11-07T12:00:00Z' }])
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

    await waitFor(() => expect(status()).toBe('1 registro aguardando envio'))
  })

  test('a rejected item alone is not counted: synced', async () => {
    await setup(async (store) => {
      const item = await store.enqueue({ kind: 'createProject', projectId: 'p-1', name: 'Blank' })
      await store.markRejected(item.seq, { status: 400, code: 'VALIDATION_FAILED' })
    })

    await waitFor(() => expect(status()).toBe(ptBR.sync.synced))
  })

  test('the pending phrase is singular for one', () => {
    expect(ptBR.sync.pending(1)).toBe('1 registro aguardando envio')
    expect(ptBR.sync.pending(3)).toBe('3 registros aguardando envio')
  })

  test("Sincronizar agora requests 'full' and is disabled while a pass runs", async () => {
    const { sync } = await setup()
    const syncNow = button(ptBR.sync.syncNow)

    fireEvent.click(syncNow)
    expect(sync.requestSync).toHaveBeenCalledExactlyOnceWith('full')

    act(() => sync.setStatus({ phase: 'downloading', lastResult: 'synced' }))
    expect(syncNow.disabled).toBe(true)

    act(() => sync.setStatus({ phase: 'idle', lastResult: 'synced' }))
    expect(syncNow.disabled).toBe(false)
  })
})
