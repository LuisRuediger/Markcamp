package com.markcamp.backend.baitsite;

import java.util.UUID;

/**
 * What the state machine replays. {@code identifiedEventId} is null except on IDENTIFIED.
 */
record BaitSiteHistoryEvent(UUID id, BaitSiteEventType type, UUID identifiedEventId) {
}
