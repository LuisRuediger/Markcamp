package com.markcamp.backend.species;

import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Global reference data, seeded by Flyway migrations and never written by the application (ADR 0005, Species). No
 * getters and no created_at: only the queries of {@link SpeciesRepository} read this.
 */
@Entity
@Table(name = "species")
class Species {

	@Id
	private UUID id;

	@Column(nullable = false)
	private String scientificName;

	@Column(nullable = false)
	private String commonName;

	protected Species() {
		// For JPA only.
	}

}
