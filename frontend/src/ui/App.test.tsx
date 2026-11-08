import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'
import { createFakeStore } from './fakeSessionStore'
import { ptBR } from './i18n/pt-BR'

test('loading shows the loading line and no sign-in form', () => {
  render(<App store={createFakeStore({ status: 'loading' })} />)

  expect(screen.getByText(ptBR.loading)).toBeTruthy()
  expect(screen.queryByRole('button', { name: ptBR.signIn.submit })).toBeNull()
})

test('signedOut shows the sign-in screen', () => {
  render(<App store={createFakeStore({ status: 'signedOut', notice: null })} />)

  expect(screen.getByRole('button', { name: ptBR.signIn.submit })).toBeTruthy()
})

test('signedIn shows the home screen', () => {
  const session = { status: 'signedIn', email: 'a@b.c', backend: 'ok' } as const
  render(<App store={createFakeStore(session)} />)

  expect(screen.getByRole('button', { name: ptBR.home.signOut })).toBeTruthy()
  expect(screen.queryByRole('button', { name: ptBR.signIn.submit })).toBeNull()
})
