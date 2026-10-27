package com.markcamp.backend.user;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * Internal user (ADR 0004, rule 1). Rows are created only by {@link UserProvisioningService}.
 */
@Entity
@Table(name = "users")
public class User {

	@Id
	private UUID id;

	@Enumerated(EnumType.STRING)
	@Column(nullable = false)
	private AuthProvider authProvider;

	@Column(nullable = false)
	private String authSubject;

	// Set by the database (DEFAULT now()); Hibernate never writes it.
	@Column(nullable = false, insertable = false, updatable = false)
	private Instant createdAt;

	protected User() {
		// For JPA only.
	}

	public UUID getId() {
		return this.id;
	}

	public AuthProvider getAuthProvider() {
		return this.authProvider;
	}

	public String getAuthSubject() {
		return this.authSubject;
	}

	public Instant getCreatedAt() {
		return this.createdAt;
	}

}
