import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant } from '../core/historyOrder'
import { createLocalCommands } from '../core/localCommands'
import type { LocalSessionSnapshot } from '../core/localSession'
import type { LocalEvent } from '../core/localStore'
import type { SessionSnapshot } from '../core/sessionStore'
import App from './App'
import { createFakeGeolocation } from './fakeGeolocation'
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
  const commands = createLocalCommands(local, { newId: () => 'id-1' }, () => new Date('2026-11-12T12:00:00Z'))
  render(<App store={store} local={local} commands={commands} installed={installed} geolocation={createFakeGeolocation().port} />)
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

describe('navigation', () => {
  const PROJECT_ID = 'p-1'

  /** Signed in and ready, over a fake LocalStore with project "Apiário" and sites Isca 1 and Isca 2. */
  async function renderReady() {
    const fakeStore = createFakeLocalStore()
    await fakeStore.replaceProjects([{ id: PROJECT_ID, name: 'Apiário', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
    const occurredAt = toHistoryInstant('2026-11-03T10:00:00Z')
    if (occurredAt === null) throw new Error('not an instant')
    await fakeStore.replaceProjectSnapshot(PROJECT_ID, {
      baitSites: ['Isca 1', 'Isca 2'].map((name, index) => ({
        id: `s-${index + 1}`,
        projectId: PROJECT_ID,
        name,
        latitude: -27.1,
        longitude: -49.1,
        locationAccuracyM: 5,
        createdAt: '2026-11-03T12:00:00Z',
      })),
      events: ['s-1', 's-2'].map((baitSiteId): LocalEvent => ({
        id: `${baitSiteId}-installed`,
        projectId: PROJECT_ID,
        baitSiteId,
        type: 'INSTALLED',
        occurredAt,
        speciesId: null,
        identifiedEventId: null,
        recordedAt: '2026-11-03T12:00:00Z',
      })),
      species: [],
    })
    const ready = createReadyLocalSession(fakeStore)
    const geo = createFakeGeolocation()
    const store = createFakeStore(SIGNED_IN)
    const commands = createLocalCommands(ready.local, { newId: () => 'id-1' }, () => new Date('2026-11-12T12:00:00Z'))
    render(<App store={store} local={ready.local} commands={commands} installed geolocation={geo.port} />)
    await screen.findByRole('button', { name: 'Apiário' })
    return { ...ready, geo }
  }

  const back = () => fireEvent.click(screen.getByRole('button', { name: ptBR.nav.back }))
  const projectsHeading = () => screen.queryByRole('heading', { name: ptBR.projects.title })
  const projectHeading = () => screen.queryByRole('heading', { name: 'Apiário' })
  const newSiteHeading = () => screen.queryByRole('heading', { name: ptBR.sites.newSite })

  async function openProject() {
    fireEvent.click(screen.getByRole('button', { name: 'Apiário' }))
    await screen.findByText('Isca 2')
  }

  test('tapping a project opens its Project screen; Voltar goes back to Projects', async () => {
    await renderReady()

    await openProject()
    expect(projectHeading()).toBeTruthy()
    expect(projectsHeading()).toBeNull()

    back()
    expect(projectsHeading()).toBeTruthy()
    expect(projectHeading()).toBeNull()
  })

  test('Novo ponto opens New site with the suggested name; Voltar goes back to the Project screen and stops the GPS', async () => {
    const { geo } = await renderReady()
    await openProject()

    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.newSite }))
    expect(newSiteHeading()).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(ptBR.sites.nameLabel).value).toBe('Isca 3')
    expect(geo.watch).toHaveBeenCalledOnce()

    back()
    expect(projectHeading()).toBeTruthy()
    expect(newSiteHeading()).toBeNull()
    expect(geo.stop).toHaveBeenCalled()
    expect(geo.activeCount()).toBe(0)
  })

  test("'queued' on New site goes back to the Project screen with the GPS stopped", async () => {
    const { geo, local } = await renderReady()
    await openProject()
    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.newSite }))

    act(() => geo.emit({ latitude: -27.3, longitude: -49.3, accuracyM: 6 }))
    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.save }))

    expect(await screen.findByRole('heading', { name: 'Apiário' })).toBeTruthy()
    expect(local.submit).toHaveBeenCalledOnce()
    expect(geo.activeCount()).toBe(0)
  })

  test('a new ready snapshot starts at Projects, even if the previous session was on a Project screen', async () => {
    const { local } = await renderReady()
    await openProject()
    expect(projectHeading()).toBeTruthy()

    // Sign-out and the next session's ready snapshot before React renders in between: the
    // screen component stays mounted and only the snapshot changes.
    const next = createReadyLocalSession()
    const nextSnapshot = next.local.getSnapshot()
    act(() => {
      local.setSnapshot({ status: 'none' })
      local.setSnapshot(nextSnapshot)
    })

    expect(projectsHeading()).toBeTruthy()
    expect(projectHeading()).toBeNull()
    expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
  })

  test('the sync bar and Sair are on Projects only', async () => {
    const { geo } = await renderReady()
    const syncBarShown = () => screen.queryByRole('button', { name: ptBR.sync.syncNow }) !== null
    const statusShown = () => screen.queryByRole('status') !== null
    const signOutShown = () => screen.queryByRole('button', { name: ptBR.home.signOut }) !== null

    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([true, true, true])

    await openProject()
    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([false, false, false])

    fireEvent.click(screen.getByRole('button', { name: ptBR.sites.newSite }))
    act(() => geo.emit({ latitude: -27.3, longitude: -49.3, accuracyM: 6 }))
    expect(newSiteHeading()).toBeTruthy()
    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([false, false, false])
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
