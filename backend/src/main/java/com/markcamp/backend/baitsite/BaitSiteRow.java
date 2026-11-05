package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

/**
 * What the read queries return. Not {@link BaitSiteResponse}: renaming a JSON field must not change a query.
 */
record BaitSiteRow(UUID id, String name, double latitude, double longitude, Double locationAccuracyM,
		Instant createdAt, BaitSiteEventType latestStatusEvent) {

	BaitSiteStatus status() {
		// No status-changing event is impossible in this slice, because every site has its INSTALLED. It is revisited with
		// voiding (slice B).
		if (this.latestStatusEvent == null) {
			return BaitSiteStatus.EMPTY;
		}
		return this.latestStatusEvent.statusAfter().orElseThrow();
	}

}
