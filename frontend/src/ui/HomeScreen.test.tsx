import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { createFakeStore } from './fakeSessionStore'
import HomeScreen from './HomeScreen'
import { ptBR } from './i18n/pt-BR'

const SESSION = { status: 'signedIn', email: 'a@b.c', backend: 'ok' } as const

test('the email is shown', () => {
  render(<HomeScreen store={createFakeStore(SESSION)} email="a@b.c" backend="ok" />)

  expect(screen.getByText(ptBR.home.signedInAs('a@b.c'))).toBeTruthy()
})

test('Sair calls signOut', () => {
  const store = createFakeStore(SESSION)
  render(<HomeScreen store={store} email="a@b.c" backend="ok" />)

  fireEvent.click(screen.getByRole('button', { name: ptBR.home.signOut }))

  expect(store.signOut).toHaveBeenCalledOnce()
})
