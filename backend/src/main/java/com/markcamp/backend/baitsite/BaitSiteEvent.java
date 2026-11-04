package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * One fact in the append-only history of a site (ADR 0005). Rows are created only by {@link BaitSiteService}.
 */
@Entity
@Table(name = "bait_site_events")
class BaitSiteEvent {

	@Id
	private UUID id;

	@Column(nullable = false)
	private UUID baitSiteId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private BaitSiteEventType eventType;

	// When it happened in the field, sent by the client (ADR 0005, rule 2).
	@Column(nullable = false)
	private Instant occurredAt;

	// Set by the database (DEFAULT now()); Hibernate never writes it.
	@Column(nullable = false, insertable = false, updatable = false)
	private Instant recordedAt;

	@Column(nullable = false)
	private UUID recordedBy;

	private UUID speciesId;

	private UUID identifiedEventId;

	private Instant voidedAt;

	private UUID voidedBy;

	protected BaitSiteEvent() {
		// For JPA only.
	}

	UUID getId() {
		return this.id;
	}

	UUID getBaitSiteId() {
		return this.baitSiteId;
	}

	BaitSiteEventType getEventType() {
		return this.eventType;
	}

	Instant getOccurredAt() {
		return this.occurredAt;
	}

	Instant getRecordedAt() {
		return this.recordedAt;
	}

	UUID getRecordedBy() {
		return this.recordedBy;
	}

	UUID getSpeciesId() {
		return this.speciesId;
	}

	UUID getIdentifiedEventId() {
		return this.identifiedEventId;
	}

	Instant getVoidedAt() {
		return this.voidedAt;
	}

	UUID getVoidedBy() {
		return this.voidedBy;
	}

}
