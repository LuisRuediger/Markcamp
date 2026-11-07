import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from './App'
import { ptBR } from './i18n/pt-BR'

test('renders the app title as a heading', () => {
  render(<App />)

  const heading = screen.getByRole('heading', { name: ptBR.appTitle })

  expect(heading.tagName).toBe('H1')
})
