import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { createFakeLocalStore } from '../core/fakeLocalStore'
import { createLocalCommands } from '../core/localCommands'
import type { SubmitOutcome } from '../core/localSession'
import { createFakeLocalSession } from './fakeLocalSession'
import { ptBR } from './i18n/pt-BR'
import NewProjectScreen from './NewProjectScreen'

/** A local session whose submit really enqueues into a fake LocalStore, so the queue can be read. */
function setup() {
  const store = createFakeLocalStore()
  const local = createFakeLocalSession()
  local.submit.mockImplementation(async (payload) => {
    await store.enqueue(payload)
    return 'queued'
  })
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
  const onBack = vi.fn<() => void>()
  const onCreated = vi.fn<() => void>()
  const view = render(<NewProjectScreen commands={commands} onBack={onBack} onCreated={onCreated} />)
  return {
    store,
    local,
    onBack,
    onCreated,
    unmount: view.unmount,
    input: screen.getByLabelText<HTMLInputElement>(ptBR.projects.nameLabel),
    submit: screen.getByRole<HTMLButtonElement>('button', { name: ptBR.projects.create }),
  }
}

function typeAndSubmit(input: HTMLInputElement, submit: HTMLButtonElement, name: string) {
  fireEvent.change(input, { target: { value: name } })
  fireEvent.click(submit)
}

test('the title and Voltar; Voltar calls onBack', () => {
  const { onBack, onCreated } = setup()

  expect(screen.getByRole('heading', { level: 1, name: ptBR.projects.newProject })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: ptBR.nav.back }))

  expect(onBack).toHaveBeenCalledOnce()
  expect(onCreated).not.toHaveBeenCalled()
})

test('the input has required and no maxLength', () => {
  const { input } = setup()

  expect(input.required).toBe(true)
  expect(input.hasAttribute('maxlength')).toBe(false)
})

test("'queued' calls onCreated, with the typed text and a new id in the queue, and shows no alert", async () => {
  const { store, local, onCreated, input, submit } = setup()

  typeAndSubmit(input, submit, '  Sítio  ')

  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
  expect(local.submit).toHaveBeenCalledExactlyOnceWith({ kind: 'createProject', projectId: 'new-1', name: '  Sítio  ' })
  expect((await store.queuedItems()).map((item) => item.payload)).toEqual([
    { kind: 'createProject', projectId: 'new-1', name: '  Sítio  ' },
  ])
  expect(screen.queryByRole('alert')).toBeNull()
})

test('the button is disabled while createProject is in flight: a double tap queues one project', async () => {
  const { local, onCreated, input, submit } = setup()
  let finish: (outcome: SubmitOutcome) => void = () => {}
  local.submit.mockReturnValue(new Promise((resolve) => (finish = resolve)))

  typeAndSubmit(input, submit, 'Sítio')
  expect(submit.disabled).toBe(true)
  fireEvent.click(submit)
  const form = submit.form
  if (form === null) throw new Error('no form')
  fireEvent.submit(form)
  expect(local.submit).toHaveBeenCalledOnce()

  finish('queued')
  await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
})

test("'notReady' shows the alert and keeps the name; onCreated is not called", async () => {
  const { local, onCreated, input, submit } = setup()
  local.submit.mockResolvedValue('notReady')

  typeAndSubmit(input, submit, 'Sítio')

  expect((await screen.findByRole('alert')).textContent).toBe(ptBR.projects.saveFailed)
  expect(input.value).toBe('Sítio')
  expect(submit.disabled).toBe(false)
  expect(onCreated).not.toHaveBeenCalled()
})

test('a rejected createProject shows the alert and keeps the name; onCreated is not called', async () => {
  const { local, onCreated, input, submit } = setup()
  local.submit.mockRejectedValue(new Error('enqueue failed'))

  typeAndSubmit(input, submit, 'Sítio')

  expect((await screen.findByRole('alert')).textContent).toBe(ptBR.projects.saveFailed)
  expect(input.value).toBe('Sítio')
  expect(submit.disabled).toBe(false)
  expect(onCreated).not.toHaveBeenCalled()
})

test('a result that arrives after the screen closed calls nothing (decision L7)', async () => {
  const { local, onCreated, onBack, input, submit, unmount } = setup()
  let finish: (outcome: SubmitOutcome) => void = () => {}
  local.submit.mockReturnValue(new Promise((resolve) => (finish = resolve)))

  typeAndSubmit(input, submit, 'Sítio')
  unmount()
  await act(async () => finish('queued'))

  expect(onCreated).not.toHaveBeenCalled()
  expect(onBack).not.toHaveBeenCalled()
})
