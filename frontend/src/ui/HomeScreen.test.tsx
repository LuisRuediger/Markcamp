import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { CreateProjectFailure, Project, ProjectsSnapshot } from '../core/projectsStore'
import { createFakeProjectsStore } from './fakeProjectsStore'
import { createFakeStore } from './fakeSessionStore'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'

const SESSION = { status: 'signedIn', email: 'a@b.c', backend: 'ok' } as const

function project(id: string, name: string): Project {
  return { id, name, role: 'OWNER', createdAt: '2026-11-07T12:00:00Z' }
}

function setup(snapshot?: ProjectsSnapshot) {
  const store = createFakeStore(SESSION)
  const projects = createFakeProjectsStore(snapshot)
  render(<HomeScreen store={store} projects={projects} email="a@b.c" backend="ok" />)
  return {
    store,
    projects,
    input: screen.getByLabelText<HTMLInputElement>(ptBR.projects.nameLabel),
    submit: screen.getByRole<HTMLButtonElement>('button', { name: ptBR.projects.create }),
  }
}

function typeAndSubmit(input: HTMLInputElement, submit: HTMLButtonElement, name: string) {
  fireEvent.change(input, { target: { value: name } })
  fireEvent.click(submit)
}

test('the email is shown', () => {
  setup()

  expect(screen.getByText(ptBR.home.signedInAs('a@b.c'))).toBeTruthy()
})

test('Sair calls signOut', () => {
  const { store } = setup()

  fireEvent.click(screen.getByRole('button', { name: ptBR.home.signOut }))

  expect(store.signOut).toHaveBeenCalledOnce()
})

describe('project list', () => {
  test('the Projetos heading is shown', () => {
    setup()

    expect(screen.getByRole('heading', { name: ptBR.projects.title })).toBeTruthy()
  })

  test('loading shows the loading line', () => {
    setup({ status: 'loading' })

    expect(screen.getByText(ptBR.projects.loading)).toBeTruthy()
  })

  test('unavailable shows the message and Tentar de novo calls reload', () => {
    const { projects } = setup({ status: 'unavailable' })

    expect(screen.getByText(ptBR.projects.unavailable)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: ptBR.projects.retry }))

    expect(projects.reload).toHaveBeenCalledOnce()
  })

  test('ready with no items shows the empty state and no list', () => {
    setup({ status: 'ready', items: [] })

    expect(screen.getByText(ptBR.projects.empty)).toBeTruthy()
    expect(screen.queryByRole('list')).toBeNull()
  })

  test('ready with items lists the names in the store order', () => {
    setup({ status: 'ready', items: [project('z', 'Zona'), project('a', 'Apiário')] })

    const names = within(screen.getByRole('list'))
      .getAllByRole('listitem')
      .map((item) => item.textContent)
    expect(names).toEqual(['Zona', 'Apiário'])
    expect(screen.queryByText(ptBR.projects.empty)).toBeNull()
  })

  test('idle renders no list state', () => {
    setup({ status: 'idle' })

    expect(screen.queryByText(ptBR.projects.loading)).toBeNull()
    expect(screen.queryByText(ptBR.projects.unavailable)).toBeNull()
    expect(screen.queryByText(ptBR.projects.empty)).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })
})

describe('create form', () => {
  test('the input has required and no maxLength', () => {
    const { input } = setup()

    expect(input.required).toBe(true)
    expect(input.hasAttribute('maxlength')).toBe(false)
  })

  test('submit calls create with the typed text', async () => {
    const { projects, input, submit } = setup()

    typeAndSubmit(input, submit, '  Sítio  ')

    expect(projects.create).toHaveBeenCalledExactlyOnceWith('  Sítio  ')
    await waitFor(() => expect(submit.disabled).toBe(false))
  })

  test('a returned nameTooLong shows the dictionary message in an alert and keeps the text', async () => {
    const { projects, input, submit } = setup()
    projects.create.mockResolvedValue('nameTooLong')

    typeAndSubmit(input, submit, 'Sítio')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(ptBR.projects.errors.nameTooLong)
    expect(input.value).toBe('Sítio')
  })

  test('success clears the input and shows no alert', async () => {
    const { input, submit } = setup()

    typeAndSubmit(input, submit, 'Sítio')

    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('the button is disabled while a creation is pending', async () => {
    const { projects, input, submit } = setup()
    let finish: (result: CreateProjectFailure | null) => void = () => {}
    projects.create.mockReturnValue(new Promise((resolve) => (finish = resolve)))

    typeAndSubmit(input, submit, 'Sítio')
    expect(submit.disabled).toBe(true)

    finish(null)

    await waitFor(() => expect(submit.disabled).toBe(false))
  })
})
