package com.markcamp.backend.baitsite;

/**
 * Derived from the events of a site, never stored (ADR 0005). "None" (before the first event) is not a status: no site
 * is ever read in that state, because a site and its first INSTALLED are created together.
 */
enum BaitSiteStatus {

	EMPTY,
	ARMED,
	ACTIVE,
	CAPTURED,
	LOST

}
