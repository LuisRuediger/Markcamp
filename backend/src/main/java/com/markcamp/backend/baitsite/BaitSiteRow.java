package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

/**
 * What the read queries return. Not {@link BaitSiteResponse}: renaming a JSON field must not change a query.
 */
record BaitSiteRow(UUID id, String name, double latitude, double longitude, Double locationAccuracyM,
		Instant createdAt) {
}
