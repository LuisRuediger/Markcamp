import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { toHistoryInstant, type HistoryInstant } from '../core/historyOrder'
import { createLocalCommands } from '../core/localCommands'
import type { LocalSessionSnapshot } from '../core/localSession'
import { LOADING, type LocalEvent, type LocalStore, type Observable, type ProjectsRaw } from '../core/localStore'
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
  render(
    <App
      store={store}
      local={local}
      commands={commands}
      installed={installed}
      geolocation={createFakeGeolocation().port}
      tileApiKey="key"
      appVersion="abc1234"
    />,
  )
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

    // After the start is decided (slice F4-2b): nothing stored, so Projects.
    expect(await screen.findByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
    expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
    expect(screen.queryByRole('button', { name: ptBR.signIn.submit })).toBeNull()
  })
})

describe('navigation', () => {
  const PROJECT_ID = 'p-1'
  const OTHER_ID = 'p-2'

  // jsdom has no layout: Leaflet would see a 0 × 0 map and load no tile. With a size, the
  // tiles it asks for say the zoom it is at (…/landscape/{z}/…), which is how these tests see
  // whether the map kept its view. The images themselves are never fetched.
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function installed(baitSiteId: string, projectId: string, occurredAt: HistoryInstant): LocalEvent {
    return {
      id: `${baitSiteId}-installed`,
      projectId,
      baitSiteId,
      type: 'INSTALLED',
      occurredAt,
      speciesId: null,
      identifiedEventId: null,
      recordedAt: '2026-11-03T12:00:00Z',
    }
  }

  /**
   * A fake LocalStore with project "Apiário" (sites Isca 1 and Isca 2, at the same spot) and
   * project "Outro" (one site, Isca 9, elsewhere), and the given last project.
   */
  async function populatedStore(lastProjectId: string | null = null) {
    const fakeStore = createFakeLocalStore()
    await fakeStore.replaceProjects([
      { id: PROJECT_ID, name: 'Apiário', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' },
      { id: OTHER_ID, name: 'Outro', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' },
    ])
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
      events: ['s-1', 's-2'].map((baitSiteId) => installed(baitSiteId, PROJECT_ID, occurredAt)),
      species: [],
    })
    await fakeStore.replaceProjectSnapshot(OTHER_ID, {
      baitSites: [
        {
          id: 's-9',
          projectId: OTHER_ID,
          name: 'Isca 9',
          latitude: -26.5,
          longitude: -48.5,
          locationAccuracyM: 5,
          createdAt: '2026-11-03T12:00:00Z',
        },
      ],
      events: [installed('s-9', OTHER_ID, occurredAt)],
      species: [],
    })
    if (lastProjectId !== null) await fakeStore.writeLastProject(lastProjectId)
    return fakeStore
  }

  /** Signed in and ready over `store`, without waiting for the start to be decided. */
  function renderReadyOver(fakeStore: LocalStore) {
    const ready = createReadyLocalSession(fakeStore)
    const geo = createFakeGeolocation()
    const store = createFakeStore(SIGNED_IN)
    const commands = createLocalCommands(ready.local, { newId: () => 'id-1' }, () => new Date('2026-11-12T12:00:00Z'))
    render(
      <App
        store={store}
        local={ready.local}
        commands={commands}
        installed
        geolocation={geo.port}
        tileApiKey="key"
        appVersion="abc1234"
      />,
    )
    return { ...ready, geo }
  }

  /** Signed in and ready over populatedStore(), with nothing stored: the start is Projects. */
  async function renderReady() {
    const rendered = renderReadyOver(await populatedStore())
    await screen.findByRole('button', { name: 'Apiário' })
    return rendered
  }

  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  const back = () => click(ptBR.nav.back)
  const projectsHeading = () => screen.queryByRole('heading', { name: ptBR.projects.title })
  /** The map's header line: only on the Map screen. */
  const mapShown = () => screen.queryByText('Apiário · 2 iscas') !== null
  /** The List's title: the Map's h1 is "MarkCamp". */
  const listHeading = () => screen.queryByRole('heading', { name: 'Apiário' })
  const newSiteHeading = () => screen.queryByRole('heading', { name: ptBR.sites.newSite })
  const newProjectHeading = () => screen.queryByRole('heading', { name: ptBR.projects.newProject })
  const settingsHeading = () => screen.queryByRole('heading', { name: ptBR.settings.title })
  const siteHeading = () => screen.queryByRole('heading', { name: 'Isca 1' })
  const recordHeading = () => screen.queryByRole('heading', { name: 'Registrar inspeção' })

  /** The zoom of the tiles the map asked for. */
  function tileZoom(): number {
    const tile = document.querySelector<HTMLImageElement>('img.leaflet-tile')
    if (tile === null) throw new Error('no tile')
    return Number(new URL(tile.src).pathname.split('/')[2])
  }

  /** "+" on the focused map: Leaflet's keyboard zoom, a move made by the user. */
  function zoomIn() {
    const map = document.querySelector('.leaflet-container')
    if (map === null) throw new Error('no map')
    fireEvent.focus(map)
    fireEvent.keyDown(document, { keyCode: 187, key: '+' })
  }

  async function openProject() {
    click('Apiário')
    await screen.findByText('Apiário · 2 iscas')
  }

  async function openList() {
    await openProject()
    click(ptBR.nav.list)
    await screen.findByText('Isca 2')
  }

  test('a new session starts at Projects, with Mapa and Lista disabled and + as Novo projeto', async () => {
    await renderReady()

    expect(projectsHeading()).toBeTruthy()
    const disabled = [ptBR.nav.map, ptBR.nav.list, ptBR.projects.newProject, ptBR.nav.settings].map(
      (name) => screen.getByRole<HTMLButtonElement>('button', { name }).disabled,
    )
    expect(disabled).toEqual([true, true, false, false])
  })

  test('tapping a project opens its map: the header, one marker per site, the bar', async () => {
    await renderReady()

    await openProject()

    expect(projectsHeading()).toBeNull()
    expect(screen.getByRole('button', { name: 'Isca 1, Armada' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Isca 2, Armada' })).toBeTruthy()
    expect(screen.getByRole('button', { name: ptBR.nav.map }).getAttribute('aria-current')).toBe('page')
  })

  test('Projetos from the map goes to Projects; Mapa then reopens the same project', async () => {
    await renderReady()
    await openProject()

    click(ptBR.nav.projects)
    expect(projectsHeading()).toBeTruthy()
    expect(mapShown()).toBe(false)

    click(ptBR.nav.map)
    expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
  })

  test('a marker opens the Site screen; Voltar goes back to the map', async () => {
    await renderReady()
    await openProject()

    click('Isca 1, Armada')
    expect(await screen.findByRole('heading', { name: 'Isca 1' })).toBeTruthy()
    expect(mapShown()).toBe(false)
    // No bar on Site.
    expect(screen.queryByRole('navigation')).toBeNull()

    back()
    expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
    expect(siteHeading()).toBeNull()
  })

  test('a site on the Lista opens the Site screen; Voltar goes back to the Lista', async () => {
    await renderReady()
    await openList()
    expect(listHeading()).toBeTruthy()

    click('Isca 1')
    await screen.findByRole('heading', { name: 'Isca 1' })
    expect(listHeading()).toBeNull()

    back()
    expect(listHeading()).toBeTruthy()
    expect(mapShown()).toBe(false)
  })

  test('+ on the map opens New site with the suggested name; Voltar goes back to the map and stops the GPS', async () => {
    const { geo } = await renderReady()
    await openProject()

    click(ptBR.sites.newSite)
    expect(newSiteHeading()).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(ptBR.sites.nameLabel).value).toBe('Isca 3')
    expect(geo.watch).toHaveBeenCalledOnce()

    back()
    expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
    expect(newSiteHeading()).toBeNull()
    expect(geo.activeCount()).toBe(0)
  })

  test("'queued' on New site goes back to the map, with the GPS stopped", async () => {
    const { geo, local } = await renderReady()
    await openProject()
    click(ptBR.sites.newSite)

    act(() => geo.emit({ latitude: -27.3, longitude: -49.3, accuracyM: 6 }))
    click(ptBR.sites.save)

    expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
    expect(local.submit).toHaveBeenCalledOnce()
    expect(geo.activeCount()).toBe(0)
  })

  test('+ on the Lista: Voltar and Salvar go back to the Lista', async () => {
    const { geo } = await renderReady()
    await openList()

    click(ptBR.sites.newSite)
    expect(newSiteHeading()).toBeTruthy()
    back()
    expect(listHeading()).toBeTruthy()

    click(ptBR.sites.newSite)
    act(() => geo.emit({ latitude: -27.3, longitude: -49.3, accuracyM: 6 }))
    click(ptBR.sites.save)
    expect(await screen.findByRole('heading', { name: 'Apiário' })).toBeTruthy()
    expect(mapShown()).toBe(false)
  })

  test('+ on Projects, after a project was opened: Novo projeto, no bar; Voltar goes back to Projects', async () => {
    const { geo } = await renderReady()
    await openProject()
    click(ptBR.nav.projects)

    click(ptBR.projects.newProject)
    expect(newProjectHeading()).toBeTruthy()
    expect(newSiteHeading()).toBeNull()
    expect(geo.watch).not.toHaveBeenCalled()
    expect(screen.queryByRole('navigation')).toBeNull()

    back()
    expect(projectsHeading()).toBeTruthy()
    expect(newProjectHeading()).toBeNull()
    // The current project is still the one opened before.
    click(ptBR.nav.map)
    expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
  })

  test("creating a project goes back to Projects, with the new project's row pending", async () => {
    const { local, store } = await renderReady()
    // This fake's submit enqueues for real, so the merge view shows the new row.
    local.submit.mockImplementation(async (payload) => {
      await store.enqueue(payload)
      return 'queued'
    })

    click(ptBR.projects.newProject)
    fireEvent.change(screen.getByLabelText(ptBR.projects.nameLabel), { target: { value: 'Sítio novo' } })
    click(ptBR.projects.create)

    const row = (await screen.findByRole('button', { name: 'Sítio novo' })).closest('li')
    expect(projectsHeading()).toBeTruthy()
    expect(newProjectHeading()).toBeNull()
    expect(row?.textContent).toContain(ptBR.projects.pendingMark)
  })

  test('first use, no project opened: + on Projects opens Novo projeto, and Ajustes opens', async () => {
    await renderReady()

    click(ptBR.projects.newProject)
    expect(newProjectHeading()).toBeTruthy()
    back()
    expect(projectsHeading()).toBeTruthy()

    click(ptBR.nav.settings)
    expect(settingsHeading()).toBeTruthy()
    expect(screen.getByRole('button', { name: ptBR.nav.settings }).getAttribute('aria-current')).toBe('page')
    // Still no current project: + on Ajustes is Novo ponto, disabled.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: ptBR.sites.newSite }).disabled).toBe(true)
  })

  test('Ajustes from the map, then Mapa goes back to the same project', async () => {
    await renderReady()
    await openProject()

    click(ptBR.nav.settings)
    expect(settingsHeading()).toBeTruthy()
    expect(mapShown()).toBe(false)

    click(ptBR.nav.map)
    expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
    expect(settingsHeading()).toBeNull()
  })

  test('+ on Ajustes opens Novo ponto; Voltar and Salvar go back to Ajustes', async () => {
    const { geo } = await renderReady()
    await openProject()
    click(ptBR.nav.settings)

    click(ptBR.sites.newSite)
    expect(newSiteHeading()).toBeTruthy()
    expect(screen.getByLabelText<HTMLInputElement>(ptBR.sites.nameLabel).value).toBe('Isca 3')
    back()
    expect(settingsHeading()).toBeTruthy()
    expect(mapShown()).toBe(false)

    click(ptBR.sites.newSite)
    act(() => geo.emit({ latitude: -27.3, longitude: -49.3, accuracyM: 6 }))
    click(ptBR.sites.save)
    expect(await screen.findByRole('heading', { name: ptBR.settings.title })).toBeTruthy()
    expect(newSiteHeading()).toBeNull()
  })

  test('the build version reaches Ajustes', async () => {
    await renderReady()

    click(ptBR.nav.settings)

    expect(screen.getByText(ptBR.settings.version('abc1234'))).toBeTruthy()
  })

  test('a new ready snapshot starts at Projects, even from Ajustes', async () => {
    const { local } = await renderReady()
    await openProject()
    click(ptBR.nav.settings)

    const next = createReadyLocalSession()
    const nextSnapshot = next.local.getSnapshot()
    act(() => {
      local.setSnapshot({ status: 'none' })
      local.setSnapshot(nextSnapshot)
    })

    // After the start is decided: the new store has no last project.
    expect(await screen.findByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
    expect(settingsHeading()).toBeNull()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: ptBR.nav.map }).disabled).toBe(true)
  })

  test('the map keeps its view for the same project, and not for another', async () => {
    await renderReady()
    await openProject()
    // Two sites at the same spot: the fit stops at its maximum zoom, 17.
    expect(tileZoom()).toBe(17)

    zoomIn()
    expect(tileZoom()).toBe(18)

    // Through the Site screen and back.
    click('Isca 1, Armada')
    await screen.findByRole('heading', { name: 'Isca 1' })
    back()
    await screen.findByText('Apiário · 2 iscas')
    expect(tileZoom()).toBe(18)

    // Through Projects and Mapa.
    click(ptBR.nav.projects)
    click(ptBR.nav.map)
    await screen.findByText('Apiário · 2 iscas')
    expect(tileZoom()).toBe(18)

    // Another project starts from its own sites: one site, zoom 16.
    click(ptBR.nav.projects)
    click('Outro')
    await screen.findByText('Outro · 1 isca')
    expect(tileZoom()).toBe(16)

    // Back to the first: the view saved for it is still there.
    click(ptBR.nav.projects)
    click('Apiário')
    await screen.findByText('Apiário · 2 iscas')
    expect(tileZoom()).toBe(18)
  })

  test('a new ready snapshot starts at Projects, even if the previous session was on a map', async () => {
    const { local } = await renderReady()
    await openProject()

    // Sign-out and the next session's ready snapshot before React renders in between: the
    // screen component stays mounted and only the snapshot changes.
    const next = createReadyLocalSession()
    const nextSnapshot = next.local.getSnapshot()
    act(() => {
      local.setSnapshot({ status: 'none' })
      local.setSnapshot(nextSnapshot)
    })

    // After the start is decided: the new store has no last project.
    expect(await screen.findByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
    expect(mapShown()).toBe(false)
    expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
    // No current project either: the previous session's project is not one tap away.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: ptBR.nav.map }).disabled).toBe(true)
  })

  describe('the start on the last project (slice F4-2b)', () => {
    const enabled = (name: string) => !screen.getByRole<HTMLButtonElement>('button', { name }).disabled

    test("the last project stored and in the list: the app opens on its map, as the current project", async () => {
      const { local } = renderReadyOver(await populatedStore(PROJECT_ID))

      expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
      expect(projectsHeading()).toBeNull()
      expect(screen.getByRole('button', { name: ptBR.nav.map }).getAttribute('aria-current')).toBe('page')
      expect([enabled(ptBR.nav.map), enabled(ptBR.nav.list)]).toEqual([true, true])
      expect(enabled(ptBR.sites.newSite)).toBe(true)
      expect(screen.queryByRole('button', { name: ptBR.projects.newProject })).toBeNull()

      // Opening it again is not a change of the current project: nothing is written.
      click(ptBR.nav.list)
      expect(await screen.findByRole('heading', { name: 'Apiário' })).toBeTruthy()
      click(ptBR.nav.map)
      await screen.findByText('Apiário · 2 iscas')
      expect(local.rememberProject).not.toHaveBeenCalled()
    })

    test('the last project stored but gone from the list: Projects, no current project', async () => {
      renderReadyOver(await populatedStore('p-gone'))

      expect(await screen.findByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
      expect(mapShown()).toBe(false)
      expect(enabled(ptBR.nav.map)).toBe(false)
    })

    /** `store` with one of its two start sources held at loading until release() is called. */
    function holding(fakeStore: LocalStore, held: 'last project' | 'list') {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      if (held === 'last project') {
        return { store: { ...fakeStore, readLastProject: () => gate.then(() => fakeStore.readLastProject()) }, release }
      }
      const observeProjects = (): Observable<ProjectsRaw> => {
        const inner = fakeStore.observeProjects()
        let open = false
        void gate.then(() => {
          open = true
        })
        return {
          subscribe(listener) {
            const unsubscribe = inner.subscribe(listener)
            void gate.then(listener)
            return unsubscribe
          },
          getSnapshot: () => (open ? inner.getSnapshot() : LOADING),
        }
      }
      return { store: { ...fakeStore, observeProjects }, release }
    }

    test.each(['last project', 'list'] as const)(
      'while the %s is loading: the loading text, neither Projects nor the map',
      async (held) => {
        const gated = holding(await populatedStore(PROJECT_ID), held)
        renderReadyOver(gated.store)
        // The other source has loaded by now.
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20))
        })

        expect(screen.getByText(ptBR.loading)).toBeTruthy()
        expect(projectsHeading()).toBeNull()
        expect(mapShown()).toBe(false)

        await act(async () => gated.release())
        expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
        expect(screen.queryByText(ptBR.loading)).toBeNull()
      },
    )

    test('rememberProject: once when a project is opened, not on screen changes, again for another project', async () => {
      const { local } = await renderReady()

      await openProject()
      expect(local.rememberProject.mock.calls).toEqual([[PROJECT_ID]])

      click(ptBR.nav.list)
      await screen.findByText('Isca 2')
      click(ptBR.nav.settings)
      click(ptBR.nav.map)
      await screen.findByText('Apiário · 2 iscas')
      expect(local.rememberProject.mock.calls).toEqual([[PROJECT_ID]])

      click(ptBR.nav.projects)
      click('Outro')
      await screen.findByText('Outro · 1 isca')
      expect(local.rememberProject.mock.calls).toEqual([[PROJECT_ID], [OTHER_ID]])
    })

    test('decided once: a list change that removes the project does not move the screen to Projects', async () => {
      const { store, projects } = renderReadyOver(await populatedStore(PROJECT_ID))
      await screen.findByText('Apiário · 2 iscas')

      await act(async () => {
        await store.replaceProjects([{ id: OTHER_ID, name: 'Outro', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
      })
      await vi.waitFor(() => {
        const listed = projects.getSnapshot()
        expect(listed.status === 'ready' && listed.value.map((entry) => entry.id)).toEqual([OTHER_ID])
      })

      // The map stays, as for any project that vanished while open.
      expect(await screen.findByRole('heading', { name: ptBR.sites.projectNotFound })).toBeTruthy()
      expect(projectsHeading()).toBeNull()
      expect(screen.getByRole('button', { name: ptBR.nav.map }).getAttribute('aria-current')).toBe('page')
    })

    test("a new ready snapshot opens its own store's last project, not the previous session's", async () => {
      const { local } = await renderReady()
      await openProject()

      const next = createReadyLocalSession(await populatedStore(OTHER_ID))
      const nextSnapshot = next.local.getSnapshot()
      act(() => {
        local.setSnapshot({ status: 'none' })
        local.setSnapshot(nextSnapshot)
      })

      expect(await screen.findByText('Outro · 1 isca')).toBeTruthy()
      expect(mapShown()).toBe(false)
      // The current project is the new one: Lista shows Outro.
      click(ptBR.nav.list)
      expect(await screen.findByRole('heading', { name: 'Outro' })).toBeTruthy()
    })
  })

  describe('Site and Record screens (decision L2 of slice F3-3a)', () => {
    async function openSite() {
      await openProject()
      click('Isca 1, Armada')
      await screen.findByRole('heading', { name: 'Isca 1' })
    }

    test('a type button opens Record; Voltar twice goes back to the map', async () => {
      await renderReady()

      await openSite()
      click(ptBR.sites.eventTypes.INSPECTED)
      expect(recordHeading()).toBeTruthy()
      expect(siteHeading()).toBeNull()

      back()
      expect(await screen.findByRole('heading', { name: 'Isca 1' })).toBeTruthy()
      expect(recordHeading()).toBeNull()

      back()
      expect(await screen.findByText('Apiário · 2 iscas')).toBeTruthy()
      expect(siteHeading()).toBeNull()
    })

    test('from the Lista, Record then Voltar twice goes back to the Lista', async () => {
      await renderReady()
      await openList()
      click('Isca 1')
      await screen.findByRole('heading', { name: 'Isca 1' })

      click(ptBR.sites.eventTypes.INSPECTED)
      back()
      await screen.findByRole('heading', { name: 'Isca 1' })
      back()

      expect(listHeading()).toBeTruthy()
    })

    test("'queued' on Record goes back to the Site screen", async () => {
      const { local } = await renderReady()
      await openSite()
      click(ptBR.sites.eventTypes.INSPECTED)
      await screen.findByRole('heading', { name: 'Registrar inspeção' })

      click(ptBR.sites.save)

      expect(await screen.findByRole('heading', { name: 'Isca 1' })).toBeTruthy()
      expect(recordHeading()).toBeNull()
      expect(local.submit).toHaveBeenCalledOnce()
      expect(local.submit.mock.calls[0]?.[0]).toMatchObject({ kind: 'recordEvent', baitSiteId: 's-1', type: 'INSPECTED' })
    })

    test('a new ready snapshot starts at Projects, even from the Site screen', async () => {
      const { local } = await renderReady()
      await openSite()

      const next = createReadyLocalSession()
      const nextSnapshot = next.local.getSnapshot()
      act(() => {
        local.setSnapshot({ status: 'none' })
        local.setSnapshot(nextSnapshot)
      })

      // After the start is decided: the new store has no last project.
      expect(await screen.findByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
      expect(siteHeading()).toBeNull()
      expect(await screen.findByText(ptBR.projects.empty)).toBeTruthy()
    })

    test('no sync bar, no Sair and no bottom bar on Site or Record', async () => {
      await renderReady()
      const anyShown = () =>
        [
          screen.queryByRole('button', { name: ptBR.sync.syncNow }),
          screen.queryByRole('status'),
          screen.queryByRole('button', { name: ptBR.home.signOut }),
          screen.queryByRole('navigation'),
        ].some((element) => element !== null)

      await openSite()
      expect(anyShown()).toBe(false)

      click(ptBR.sites.eventTypes.INSPECTED)
      expect(recordHeading()).toBeTruthy()
      expect(anyShown()).toBe(false)
    })
  })

  test('the sync bar and Sair are on Ajustes only', async () => {
    const { geo } = await renderReady()
    const syncBarShown = () => screen.queryByRole('button', { name: ptBR.sync.syncNow }) !== null
    const statusShown = () => screen.queryByRole('status') !== null
    const signOutShown = () => screen.queryByRole('button', { name: ptBR.home.signOut }) !== null

    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([false, false, false])

    click(ptBR.nav.settings)
    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([true, true, true])

    click(ptBR.nav.projects)
    click(ptBR.projects.newProject)
    expect(newProjectHeading()).toBeTruthy()
    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([false, false, false])
    back()

    await openProject()
    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([false, false, false])

    click(ptBR.nav.list)
    await screen.findByText('Isca 2')
    expect([syncBarShown(), statusShown(), signOutShown()]).toEqual([false, false, false])

    click(ptBR.sites.newSite)
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
