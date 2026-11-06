package com.markcamp.backend.species;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Needs a token like every endpoint, but no requireMember: species is global reference data, the same for everyone. The
 * project access check of ADR 0001 and ADR 0005 rule 6 covers bait sites, events and their data, not this list.
 * <p>
 * No HTTP caching, so Spring Security's default Cache-Control (no-store) stays: the app keeps its own offline copy of the
 * list, because it needs it in the field without signal, and refreshes it when online. HTTP caching would only add an
 * invalidation-on-deploy question for 16 rows.
 */
@RestController
class SpeciesController {

	private final SpeciesService speciesService;

	SpeciesController(SpeciesService speciesService) {
		this.speciesService = speciesService;
	}

	@GetMapping("/api/species")
	SpeciesListResponse list() {
		return new SpeciesListResponse(this.speciesService.list());
	}

}
