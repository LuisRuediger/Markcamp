package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Rows are created only by {@link BaitSiteService}. No status field: status is derived from events (ADR 0005).
 */
@Entity
@Table(name = "bait_sites")
class BaitSite {

	@Id
	private UUID id;

	@Column(nullable = false)
	private UUID projectId;

	@Column(nullable = false)
	private String name;

	@Column(nullable = false)
	private double latitude;

	@Column(nullable = false)
	private double longitude;

	// Named explicitly: Boot's naming strategy does not put an underscore before the last letter (location_accuracym).
	@Column(name = "location_accuracy_m")
	private Double locationAccuracyM;

	// Attribution only, never authorization (ADR 0001, rule 1).
	@Column(nullable = false)
	private UUID createdBy;

	// Set by the database (DEFAULT now()); Hibernate never writes it.
	@Column(nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	protected BaitSite() {
		// For JPA only.
	}

	UUID getId() {
		return this.id;
	}

	UUID getProjectId() {
		return this.projectId;
	}

	String getName() {
		return this.name;
	}

	double getLatitude() {
		return this.latitude;
	}

	double getLongitude() {
		return this.longitude;
	}

	Double getLocationAccuracyM() {
		return this.locationAccuracyM;
	}

	UUID getCreatedBy() {
		return this.createdBy;
	}

	Instant getCreatedAt() {
		return this.createdAt;
	}

}
