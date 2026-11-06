package com.markcamp.backend.species;

import java.util.UUID;

import org.springframework.stereotype.Component;

/**
 * What other packages may ask about species. Everything else in this package stays package-private.
 */
@Component
public class SpeciesCatalog {

	private final SpeciesRepository speciesRepository;

	SpeciesCatalog(SpeciesRepository speciesRepository) {
		this.speciesRepository = speciesRepository;
	}

	public boolean exists(UUID speciesId) {
		return this.speciesRepository.existsById(speciesId);
	}

}
