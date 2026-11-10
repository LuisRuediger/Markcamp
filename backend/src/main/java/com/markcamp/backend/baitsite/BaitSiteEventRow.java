package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

/**
 * What the read queries return. Not {@link BaitSiteEventResponse}: renaming a JSON field must not change a query.
 */
record BaitSiteEventRow(UUID id, UUID baitSiteId, BaitSiteEventType type, Instant occurredAt, UUID speciesId,
		UUID identifiedEventId, Instant recordedAt, Instant voidedAt) {
}
