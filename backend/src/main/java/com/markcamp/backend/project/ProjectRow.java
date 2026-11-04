package com.markcamp.backend.project;

import java.time.Instant;
import java.util.UUID;

/**
 * What the list query reads. Not {@link ProjectResponse}: renaming a JSON field must not change a query.
 */
record ProjectRow(UUID id, String name, ProjectRole role, Instant createdAt) {
}
