import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { createProjectViewCache, type ProjectView } from '../core/localMerge'
import type { LocalStore, Observable } from '../core/localStore'
import BottomNav, { type NavTab } from './BottomNav'
import { ptBR } from './i18n/pt-BR'

const P = 'p-1'

function setup(current: NavTab, project: Observable<ProjectView> | null) {
  const handlers = {
    onMap: vi.fn<() => void>(),
    onList: vi.fn<() => void>(),
    onProjects: vi.fn<() => void>(),
    onSettings: vi.fn<() => void>(),
    onNewSite: vi.fn<(suggestedName: string) => void>(),
    onNewProject: vi.fn<() => void>(),
  }
  const { container } = render(<BottomNav current={current} project={project} {...handlers} />)
  return { ...handlers, container }
}

async function projectView(prepare: (store: LocalStore) => Promise<void>): Promise<Observable<ProjectView>> {
  const store = createFakeLocalStore()
  await prepare(store)
  return createProjectViewCache(store)(P)
}

async function confirmed(store: LocalStore) {
  await store.replaceProjects([{ id: P, name: 'Apiário', role: 'OWNER', createdAt: '2026-11-01T12:00:00Z' }])
  await store.replaceProjectSnapshot(P, {
    baitSites: ['Isca 1', 'Isca 4'].map((name, index) => ({
      id: `s-${index + 1}`,
      projectId: P,
      name,
      latitude: -27.1,
      longitude: -49.1,
      locationAccuracyM: 5,
      createdAt: '2026-11-01T12:00:00Z',
    })),
    events: [],
    species: [],
  })
}

const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name })
const plus = () => button(ptBR.sites.newSite)
const newProject = () => button(ptBR.projects.newProject)

test('Mapa, Lista, the +, Projetos and Ajustes, in that order', async () => {
  const { container } = setup('map', await projectView(confirmed))

  const nav = screen.getByRole('navigation')
  expect([...nav.children].map((child) => child.textContent)).toEqual(['Mapa', 'Lista', '', 'Projetos', 'Ajustes'])
  expect(screen.getAllByRole('button').map((item) => item.getAttribute('aria-label') ?? item.textContent)).toEqual([
    'Mapa',
    'Lista',
    'Novo ponto',
    'Projetos',
    'Ajustes',
  ])
  expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(5)
})

test.each<[NavTab, string]>([
  ['map', 'Mapa'],
  ['list', 'Lista'],
  ['projects', 'Projetos'],
  ['settings', 'Ajustes'],
])('on %s, only %s is the current page', async (current, label) => {
  setup(current, await projectView(confirmed))

  const marked = screen.getAllByRole('button').filter((item) => item.getAttribute('aria-current') === 'page')
  expect(marked.map((item) => item.textContent)).toEqual([label])
})

test('the items call their handlers', async () => {
  const { onMap, onList, onProjects, onSettings } = setup('projects', await projectView(confirmed))

  fireEvent.click(button('Mapa'))
  fireEvent.click(button('Lista'))
  fireEvent.click(button('Projetos'))
  fireEvent.click(button('Ajustes'))

  expect([
    onMap.mock.calls.length,
    onList.mock.calls.length,
    onProjects.mock.calls.length,
    onSettings.mock.calls.length,
  ]).toEqual([1, 1, 1, 1])
})

test('no current project: Mapa, Lista and Novo ponto disabled; Projetos and Ajustes enabled', () => {
  setup('map', null)

  expect([
    button('Mapa').disabled,
    button('Lista').disabled,
    plus().disabled,
    button('Projetos').disabled,
    button('Ajustes').disabled,
  ]).toEqual([true, true, true, false, false])
})

test('Ajustes is enabled with a current project too', async () => {
  setup('map', await projectView(confirmed))

  expect(button('Ajustes').disabled).toBe(false)
})

describe('the + on Projetos: Novo projeto', () => {
  test('named "Novo projeto", enabled with no current project, and calls onNewProject', () => {
    const { onNewProject, onNewSite } = setup('projects', null)

    expect(screen.queryByRole('button', { name: ptBR.sites.newSite })).toBeNull()
    expect(newProject().disabled).toBe(false)
    fireEvent.click(newProject())

    expect(onNewProject).toHaveBeenCalledOnce()
    expect(onNewSite).not.toHaveBeenCalled()
  })

  test('enabled with a rejected current project, and calls onNewProject', async () => {
    const view = await projectView(async (store) => {
      const item = await store.enqueue({ kind: 'createProject', projectId: P, name: 'Recusado' })
      await store.markRejected(item.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
    })
    const { onNewProject, onNewSite } = setup('projects', view)

    // On Projetos the bar never subscribes to the view, so the test does, to load it.
    const unsubscribe = view.subscribe(() => {})
    await waitFor(() => expect(view.getSnapshot().status).toBe('ready'))
    await act(async () => {})
    expect(newProject().disabled).toBe(false)
    fireEvent.click(newProject())

    expect(onNewProject).toHaveBeenCalledOnce()
    expect(onNewSite).not.toHaveBeenCalled()
    unsubscribe()
  })

  test('enabled while the current project view is still loading', async () => {
    setup('projects', await projectView(confirmed))

    expect(newProject().disabled).toBe(false)
  })
})

describe.each<NavTab>(['map', 'list', 'settings'])('the + on %s: Novo ponto', (current) => {
  test('named "Novo ponto", disabled with no current project', () => {
    const { onNewSite, onNewProject } = setup(current, null)

    expect(screen.queryByRole('button', { name: ptBR.projects.newProject })).toBeNull()
    expect(plus().disabled).toBe(true)
    fireEvent.click(plus())
    expect(onNewSite).not.toHaveBeenCalled()
    expect(onNewProject).not.toHaveBeenCalled()
  })

  test('disabled while the view loads, then passes "Isca N"', async () => {
    const { onNewSite, onNewProject } = setup(current, await projectView(confirmed))

    expect(plus().disabled).toBe(true)
    await waitFor(() => expect(plus().disabled).toBe(false))
    fireEvent.click(plus())

    expect(onNewSite).toHaveBeenCalledExactlyOnceWith('Isca 5')
    expect(onNewProject).not.toHaveBeenCalled()
  })

  test('disabled for a rejected project', async () => {
    const view = await projectView(async (store) => {
      const item = await store.enqueue({ kind: 'createProject', projectId: P, name: 'Recusado' })
      await store.markRejected(item.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
    })
    setup(current, view)

    await waitFor(() => expect(view.getSnapshot().status).toBe('ready'))
    await act(async () => {})
    expect(plus().disabled).toBe(true)
  })
})

describe('the +', () => {
  test('disabled while the view loads, then passes "Isca N" from the current sites', async () => {
    const { onNewSite } = setup('map', await projectView(confirmed))

    expect(plus().disabled).toBe(true)
    await waitFor(() => expect(plus().disabled).toBe(false))
    fireEvent.click(plus())

    expect(onNewSite).toHaveBeenCalledExactlyOnceWith('Isca 5')
  })

  test('disabled for a rejected project', async () => {
    const view = await projectView(async (store) => {
      const item = await store.enqueue({ kind: 'createProject', projectId: P, name: 'Recusado' })
      await store.markRejected(item.seq, { status: 409, code: 'INVALID_EVENT_SEQUENCE' })
    })
    const { onNewSite } = setup('list', view)

    await waitFor(() => expect(view.getSnapshot().status).toBe('ready'))
    // Let React render the ready view before looking: disabled while loading proves nothing.
    await act(async () => {})
    expect(plus().disabled).toBe(true)
    fireEvent.click(plus())
    expect(onNewSite).not.toHaveBeenCalled()
  })

  test('enabled for a project that is only pending', async () => {
    const view = await projectView(async (store) => {
      await store.enqueue({ kind: 'createProject', projectId: P, name: 'Offline' })
    })
    const { onNewSite } = setup('list', view)

    await waitFor(() => expect(plus().disabled).toBe(false))
    fireEvent.click(plus())
    expect(onNewSite).toHaveBeenCalledExactlyOnceWith('Isca 1')
  })

  test('disabled for a project that is gone', async () => {
    const view = await projectView(async () => {})
    setup('map', view)

    await waitFor(() => expect(view.getSnapshot().status).toBe('ready'))
    // Let React render the ready view before looking: disabled while loading proves nothing.
    await act(async () => {})
    expect(plus().disabled).toBe(true)
  })
})
