package com.markcamp.backend.baitsite;

import java.util.Optional;

/**
 * The event types of ADR 0005, with its "Status after" column as data. This is the only place that maps an event type
 * to a status: the state machine and the status query both read it from here.
 */
enum BaitSiteEventType {

	INSTALLED(BaitSiteStatus.ARMED),
	ACTIVITY(BaitSiteStatus.ACTIVE),
	CAPTURED(BaitSiteStatus.CAPTURED),
	LOST(BaitSiteStatus.LOST),
	COLLECTED(BaitSiteStatus.EMPTY),
	REMOVED(BaitSiteStatus.EMPTY),
	INSPECTED(null),
	IDENTIFIED(null);

	private final BaitSiteStatus statusAfter;

	BaitSiteEventType(BaitSiteStatus statusAfter) {
		this.statusAfter = statusAfter;
	}

	/**
	 * Empty when the event leaves the status unchanged.
	 */
	Optional<BaitSiteStatus> statusAfter() {
		return Optional.ofNullable(this.statusAfter);
	}

}
