package com.markcamp.backend.project;

import java.util.UUID;

/**
 * Holding one is the proof that the access check ran: only {@link ProjectAccess} can create it. Services and
 * repositories for bait sites and events will take a ProjectMembership, never a bare project id, so forgetting the
 * check does not compile.
 * <p>
 * Not a record: the canonical constructor of a record cannot be less accessible than the record, so any package
 * could create one.
 */
public final class ProjectMembership {

	private final UUID projectId;

	private final UUID userId;

	private final ProjectRole role;

	ProjectMembership(UUID projectId, UUID userId, ProjectRole role) {
		this.projectId = projectId;
		this.userId = userId;
		this.role = role;
	}

	public UUID projectId() {
		return this.projectId;
	}

	public UUID userId() {
		return this.userId;
	}

	public ProjectRole role() {
		return this.role;
	}

}
