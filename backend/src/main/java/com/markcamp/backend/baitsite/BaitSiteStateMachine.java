package com.markcamp.backend.baitsite;

import java.util.EnumSet;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The transition table of ADR 0005. {@code shared/bait-site-state-machine-cases.json} is the contract for this class and
 * for any other implementation of it.
 * <p>
 * It does not sort, and nothing else may sort events in Java: ordering always happens in SQL ({@code ORDER BY occurred_at,
 * id}). {@code UUID.compareTo} compares as signed longs and Postgres compares {@code uuid} as unsigned bytes, so a Java
 * sort would break ties differently from the status query.
 */
final class BaitSiteStateMachine {

	sealed interface Replay permits Valid, Invalid {
	}

	record Valid(BaitSiteStatus status) implements Replay {
	}

	record Invalid(int firstInvalidIndex) implements Replay {
	}

	private BaitSiteStateMachine() {
	}

	/**
	 * Replays non-voided events that are already in history order.
	 */
	static Replay replay(List<BaitSiteHistoryEvent> eventsInHistoryOrder) {
		if (eventsInHistoryOrder.isEmpty()) {
			// Happens only when every event of a site is voided (ADR 0005, rule 3 as amended).
			return new Valid(BaitSiteStatus.EMPTY);
		}
		// Null until the first event: "none" in the table of ADR 0005.
		BaitSiteStatus status = null;
		// Equality only, which is the same in Java and in Postgres. A voided capture needs no code here: the history has
		// only non-voided events, so it never enters this set. Voiding relies on it.
		Set<UUID> earlierCaptures = new HashSet<>();
		for (int i = 0; i < eventsInHistoryOrder.size(); i++) {
			BaitSiteHistoryEvent event = eventsInHistoryOrder.get(i);
			BaitSiteEventType type = event.type();
			boolean allowed = (status != null) ? allowedFrom(type).contains(status) : type == BaitSiteEventType.INSTALLED;
			if (type == BaitSiteEventType.IDENTIFIED && !earlierCaptures.contains(event.identifiedEventId())) {
				allowed = false;
			}
			if (!allowed) {
				return new Invalid(i);
			}
			if (type == BaitSiteEventType.CAPTURED) {
				earlierCaptures.add(event.id());
			}
			status = type.statusAfter().orElse(status);
		}
		return new Valid(status);
	}

	// A switch with no default: a new event type does not compile until it has a row here.
	private static Set<BaitSiteStatus> allowedFrom(BaitSiteEventType event) {
		return switch (event) {
			case INSTALLED -> EnumSet.of(BaitSiteStatus.EMPTY, BaitSiteStatus.LOST);
			case ACTIVITY -> EnumSet.of(BaitSiteStatus.ARMED, BaitSiteStatus.ACTIVE);
			case CAPTURED -> EnumSet.of(BaitSiteStatus.ARMED, BaitSiteStatus.ACTIVE, BaitSiteStatus.LOST);
			case LOST, COLLECTED -> EnumSet.of(BaitSiteStatus.CAPTURED);
			case REMOVED -> EnumSet.of(BaitSiteStatus.ARMED, BaitSiteStatus.ACTIVE, BaitSiteStatus.LOST);
			case INSPECTED -> EnumSet.complementOf(EnumSet.of(BaitSiteStatus.EMPTY));
			// Any status. What it does depend on is the capture it points to, checked in replay().
			case IDENTIFIED -> EnumSet.allOf(BaitSiteStatus.class);
		};
	}

}
