package com.markcamp.backend.project;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code role} is the caller's role in the project, from project_members.
 */
record ProjectResponse(UUID id, String name, ProjectRole role, Instant createdAt) {
}
