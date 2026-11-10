package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

/**
 * The same shape from every endpoint, so the client has one parser. baitSiteId is here because the client writes this
 * response into its local copy (ADR 0008), and in the project-wide list the event has no site in the path.
 */
record BaitSiteEventResponse(UUID id, UUID baitSiteId, BaitSiteEventType type, Instant occurredAt, UUID speciesId,
		UUID identifiedEventId, Instant recordedAt, Instant voidedAt) {
}
