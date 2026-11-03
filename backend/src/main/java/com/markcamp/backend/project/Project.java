package com.markcamp.backend.project;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Rows are created only by {@link ProjectService}.
 */
@Entity
@Table(name = "projects")
class Project {

	@Id
	private UUID id;

	@Column(nullable = false)
	private String name;

	// Attribution only, never authorization (ADR 0001, rule 1).
	@Column(nullable = false)
	private UUID createdBy;

	// Set by the database (DEFAULT now()); Hibernate never writes it.
	@Column(nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	protected Project() {
		// For JPA only.
	}

	UUID getId() {
		return this.id;
	}

	String getName() {
		return this.name;
	}

	UUID getCreatedBy() {
		return this.createdBy;
	}

	Instant getCreatedAt() {
		return this.createdAt;
	}

}
