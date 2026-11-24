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
    onNewSite: vi.fn<(suggestedName: string) => void>(),
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

test('Mapa, Lista, the +, Projetos and an empty fifth column, in that order', async () => {
  const { container } = setup('map', await projectView(confirmed))

  const nav = screen.getByRole('navigation')
  expect([...nav.children].map((child) => child.textContent)).toEqual(['Mapa', 'Lista', '', 'Projetos', ''])
  expect(screen.getAllByRole('button').map((item) => item.getAttribute('aria-label') ?? item.textContent)).toEqual([
    'Mapa',
    'Lista',
    'Novo ponto',
    'Projetos',
  ])
  // The fifth column holds nothing (Ajustes in slice F4-2).
  expect(nav.lastElementChild?.childElementCount).toBe(0)
  expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4)
})

test.each<[NavTab, string]>([
  ['map', 'Mapa'],
  ['list', 'Lista'],
  ['projects', 'Projetos'],
])('on %s, only %s is the current page', async (current, label) => {
  setup(current, await projectView(confirmed))

  const marked = screen.getAllByRole('button').filter((item) => item.getAttribute('aria-current') === 'page')
  expect(marked.map((item) => item.textContent)).toEqual([label])
})

test('the items call their handlers', async () => {
  const { onMap, onList, onProjects } = setup('projects', await projectView(confirmed))

  fireEvent.click(button('Mapa'))
  fireEvent.click(button('Lista'))
  fireEvent.click(button('Projetos'))

  expect([onMap.mock.calls.length, onList.mock.calls.length, onProjects.mock.calls.length]).toEqual([1, 1, 1])
})

test('no current project: Mapa, Lista and + disabled; Projetos enabled', () => {
  setup('projects', null)

  expect([button('Mapa').disabled, button('Lista').disabled, plus().disabled, button('Projetos').disabled]).toEqual([
    true,
    true,
    true,
    false,
  ])
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
