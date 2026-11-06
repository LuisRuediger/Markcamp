package com.markcamp.backend.species;

import java.util.UUID;

record SpeciesResponse(UUID id, String scientificName, String commonName) {
}
