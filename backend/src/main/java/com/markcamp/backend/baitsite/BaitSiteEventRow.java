package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.UUID;

/**
 * What the read queries return. Not {@link BaitSiteEventResponse}: renaming a JSON field must not change a query.
 */
record BaitSiteEventRow(UUID id, BaitSiteEventType type, Instant occurredAt, Instant recordedAt) {
}
