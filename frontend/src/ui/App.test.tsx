import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { createLocalCommands } from '../core/localCommands'
import type { LocalSessionSnapshot } from '../core/localSession'
import type { SessionSnapshot } from '../core/sessionStore'
import App from './App'
import { createFakeLocalSession, createReadyLocalSession } from './fakeLocalSession'
import { createFakeStore } from './fakeSessionStore'
import { ptBR } from './i18n/pt-BR'

const SIGNED_IN: SessionSnapshot = { status: 'signedIn', email: 'a@b.c', backend: 'ok' }

function renderApp(
  session: SessionSnapshot,
  local = createFakeLocalSession(),
  installed = true,
) {
  const store = createFakeStore(session)
  const commands = createLocalCommands(local, { newId: () => 'id-1' })
  render(<App store={store} local={local} commands={commands} installed={installed} />)
  return { store, local }
}

function localIn(status: Exclude<LocalSessionSnapshot['status'], 'ready'>) {
  return createFakeLocalSession({ status })
}

test('session loading shows the loading line and no sign-in form', () => {
  renderApp({ status: 'loading' })

  expect(screen.getByText(ptBR.loading)).toBeTruthy()
  expect(screen.queryByRole('button', { name: ptBR.signIn.submit })).toBeNull()
})

test('signedOut shows the sign-in screen and no projects', () => {
  renderApp({ status: 'signedOut', notice: null })

  expect(screen.getByRole('button', { name: ptBR.signIn.submit })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: ptBR.projects.title })).toBeNull()
})

describe('signed in, by local session status', () => {
  test.each(['none', 'opening'] as const)('%s shows the loading line and sign-out', (status) => {
    const { store } = renderApp(SIGNED_IN, localIn(status))

    expect(screen.getByText(ptBR.loading)).toBeTruthy()
    expect(screen.queryByRole('heading', { name: ptBR.projects.title })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: ptBR.home.signOut }))
    expect(store.signOut).toHaveBeenCalledOnce()
  })

  test('needsFirstOnline shows its text, and Tentar de novo calls retryBackendCheck', () => {
    const { store } = renderApp(SIGNED_IN, localIn('needsFirstOnline'))

    expect(screen.getByText(ptBR.localSession.needsFirstOnline)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: ptBR.retry }))

    expect(store.retryBackendCheck).toHaveBeenCalledOnce()
  })

  test('failed shows its text, no retry button, and sign-out', () => {
    const { store } = renderApp(SIGNED_IN, localIn('failed'))

    expect(screen.getByText(ptBR.localSession.failed)).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.retry })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: ptBR.home.signOut }))
    expect(store.signOut).toHaveBeenCalledOnce()
  })

  test('ready shows the home screen with the projects', async () => {
    renderApp(SIGNED_IN, createReadyLocalSession().local)

    expect(screen.getByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
    expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.signIn.submit })).toBeNull()
  })
})

describe('install banner', () => {
  const states: [string, SessionSnapshot, () => ReturnType<typeof createFakeLocalSession>][] = [
    ['the sign-in screen', { status: 'signedOut', notice: null }, () => localIn('none')],
    ['session loading', { status: 'loading' }, () => localIn('none')],
    ['local session opening', SIGNED_IN, () => localIn('opening')],
    ['the home screen', SIGNED_IN, () => createReadyLocalSession().local],
  ]

  test.each(states)('shows on %s when not installed', (_name, session, local) => {
    renderApp(session, local(), false)

    expect(screen.getByText(ptBR.installBanner)).toBeTruthy()
  })

  test.each(states)('does not show on %s when installed', (_name, session, local) => {
    renderApp(session, local(), true)

    expect(screen.queryByText(ptBR.installBanner)).toBeNull()
  })
})
