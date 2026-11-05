package com.markcamp.backend.baitsite;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;

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
	 * Replays event types that are already in history order.
	 */
	static Replay replay(List<BaitSiteEventType> eventsInHistoryOrder) {
		if (eventsInHistoryOrder.isEmpty()) {
			// "None" is not a status, so there is nothing to answer. The replay always includes the event being written.
			throw new IllegalArgumentException("There are no events to replay");
		}
		// Null until the first event: "none" in the table of ADR 0005.
		BaitSiteStatus status = null;
		for (int i = 0; i < eventsInHistoryOrder.size(); i++) {
			BaitSiteEventType event = eventsInHistoryOrder.get(i);
			Set<BaitSiteStatus> allowedFrom = allowedFrom(event);
			boolean allowed = (status != null) ? allowedFrom.contains(status) : event == BaitSiteEventType.INSTALLED;
			if (!allowed) {
				return new Invalid(i);
			}
			status = event.statusAfter().orElse(status);
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
			// No IDENTIFIED can exist yet, because the API rejects the type. Its rule depends on the capture it points to,
			// which comes with species.
			case IDENTIFIED -> throw new IllegalStateException("IDENTIFIED cannot be replayed yet");
		};
	}

}
