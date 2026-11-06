package com.markcamp.backend.species;

import java.util.UUID;

/**
 * What the list query reads. Not {@link SpeciesResponse}: renaming a JSON field must not change a query.
 */
record SpeciesRow(UUID id, String scientificName, String commonName) {
}
