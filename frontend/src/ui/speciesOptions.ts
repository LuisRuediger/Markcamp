import type { LocalSpecies } from '../core/localStore'

// The species picker's order (decision L4 of slice F3-3a): by common name, the text the person
// reads, compared as Portuguese (accents and ç in their place); ties by scientific name.
//
// The one list ui sorts: a fixed catalogue ordered by what is on screen, never by id. The
// comparator lives here because it needs a locale, and core has none (ADR 0007).

function compareSpecies(a: LocalSpecies, b: LocalSpecies): number {
  return a.commonName.localeCompare(b.commonName, 'pt-BR') || a.scientificName.localeCompare(b.scientificName, 'pt-BR')
}

/** A new array in picker order; the input is not changed. */
export function speciesOptions(species: readonly LocalSpecies[]): readonly LocalSpecies[] {
  return species.toSorted(compareSpecies)
}
