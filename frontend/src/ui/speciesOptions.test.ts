import { expect, test } from 'vitest'
import type { LocalSpecies } from '../core/localStore'
import { speciesOptions } from './speciesOptions'

function species(commonName: string, scientificName = `${commonName} sp.`): LocalSpecies {
  return { id: `id-${scientificName}`, commonName, scientificName }
}

test('by common name in Portuguese, accents and ç included; the input is not changed', () => {
  const input = ['Manduri', 'Mandaguari-amarela', 'Jataí', 'Iraí', 'Mandaçaia', 'Borá', 'Mandaguari', 'Guaraipo'].map((name) =>
    species(name),
  )
  const before = input.map((option) => option.commonName)

  expect(speciesOptions(input).map((option) => option.commonName)).toEqual([
    'Borá',
    'Guaraipo',
    'Iraí',
    'Jataí',
    'Mandaçaia',
    'Mandaguari',
    'Mandaguari-amarela',
    'Manduri',
  ])
  expect(input.map((option) => option.commonName)).toEqual(before)
})

test('the same common name: by scientific name', () => {
  const input = [species('Tubuna', 'Scaptotrigona postica'), species('Tubuna', 'Scaptotrigona bipunctata')]

  expect(speciesOptions(input).map((option) => option.scientificName)).toEqual([
    'Scaptotrigona bipunctata',
    'Scaptotrigona postica',
  ])
})

test('empty in, empty out', () => {
  expect(speciesOptions([])).toEqual([])
})
