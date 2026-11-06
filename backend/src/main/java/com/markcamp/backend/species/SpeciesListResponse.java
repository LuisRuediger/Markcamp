package com.markcamp.backend.species;

import java.util.List;

/**
 * An object, not a bare array, like the other lists of the API: a field can be added later without breaking old clients.
 */
record SpeciesListResponse(List<SpeciesResponse> items) {
}
