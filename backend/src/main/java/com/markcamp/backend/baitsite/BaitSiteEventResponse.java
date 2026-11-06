package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

record BaitSiteEventResponse(UUID id, BaitSiteEventType type, Instant occurredAt, UUID speciesId,
		UUID identifiedEventId, Instant recordedAt, Instant voidedAt) {
}
