import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { SignInFailureKind } from '../core/sessionStore'
import { createFakeStore } from './fakeSessionStore'
import { ptBR } from './i18n/pt-BR'
import SignInScreen from './SignInScreen'

function setup(notice: 'sessionExpired' | null = null) {
  const store = createFakeStore({ status: 'signedOut', notice })
  render(<SignInScreen store={store} notice={notice} />)
  return {
    store,
    submit: screen.getByRole<HTMLButtonElement>('button', { name: ptBR.signIn.submit }),
    google: screen.getByRole<HTMLButtonElement>('button', { name: ptBR.signIn.google }),
  }
}

function fillAndSubmit(submit: HTMLButtonElement) {
  fireEvent.change(screen.getByLabelText(ptBR.signIn.email), { target: { value: 'a@b.c' } })
  fireEvent.change(screen.getByLabelText(ptBR.signIn.password), { target: { value: 'pw' } })
  fireEvent.click(submit)
}

test('submit calls signInWithEmail with the typed values', async () => {
  const { store, submit } = setup()

  fillAndSubmit(submit)

  expect(store.signInWithEmail).toHaveBeenCalledExactlyOnceWith('a@b.c', 'pw')
  await waitFor(() => expect(submit.disabled).toBe(false))
})

test('a returned invalidCredentials shows the dictionary message in an alert', async () => {
  const { store, submit } = setup()
  store.signInWithEmail.mockResolvedValue('invalidCredentials')

  fillAndSubmit(submit)

  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toBe(ptBR.signIn.errors.invalidCredentials)
})

test('a closed popup, returned as null, shows no alert', async () => {
  const { store, google } = setup()
  store.signInWithGoogle.mockResolvedValue(null)

  fireEvent.click(google)

  expect(store.signInWithGoogle).toHaveBeenCalledOnce()
  await waitFor(() => expect(google.disabled).toBe(false))
  expect(screen.queryByRole('alert')).toBeNull()
})

test('both buttons are disabled while a sign-in is pending', async () => {
  const { store, submit, google } = setup()
  let finish: (result: SignInFailureKind | null) => void = () => {}
  store.signInWithEmail.mockReturnValue(new Promise((resolve) => (finish = resolve)))

  fillAndSubmit(submit)

  expect(submit.disabled).toBe(true)
  expect(google.disabled).toBe(true)

  finish(null)

  await waitFor(() => expect(submit.disabled).toBe(false))
  expect(google.disabled).toBe(false)
})

test('the sessionExpired notice is shown', () => {
  setup('sessionExpired')

  expect(screen.getByText(ptBR.signIn.sessionExpired)).toBeTruthy()
})
