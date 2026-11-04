package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

/**
 * {@code locationAccuracyM} is null when the site was placed by hand on the map.
 */
record BaitSiteResponse(UUID id, String name, double latitude, double longitude, Double locationAccuracyM,
		Instant createdAt) {
}
