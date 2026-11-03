package com.markcamp.backend.project;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * The only source of authorization (ADR 0001). Rows are created only by {@link ProjectService}.
 */
@Entity
@Table(name = "project_members")
class ProjectMember {

	@Id
	private UUID id;

	@Column(nullable = false)
	private UUID projectId;

	@Column(nullable = false)
	private UUID userId;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private ProjectRole role;

	// Set by the database (DEFAULT now()); Hibernate never writes it.
	@Column(nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	protected ProjectMember() {
		// For JPA only.
	}

	UUID getId() {
		return this.id;
	}

	UUID getProjectId() {
		return this.projectId;
	}

	UUID getUserId() {
		return this.userId;
	}

	ProjectRole getRole() {
		return this.role;
	}

	Instant getCreatedAt() {
		return this.createdAt;
	}

}
