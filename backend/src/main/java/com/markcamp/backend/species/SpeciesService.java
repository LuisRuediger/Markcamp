package com.markcamp.backend.species;

import java.util.List;

import org.springframework.stereotype.Service;

@Service
class SpeciesService {

	private final SpeciesRepository speciesRepository;

	SpeciesService(SpeciesRepository speciesRepository) {
		this.speciesRepository = speciesRepository;
	}

	List<SpeciesResponse> list() {
		return this.speciesRepository.findAllRows()
			.stream()
			.map((row) -> new SpeciesResponse(row.id(), row.scientificName(), row.commonName()))
			.toList();
	}

}
