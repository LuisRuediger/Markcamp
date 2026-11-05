package com.markcamp.backend.baitsite;

import org.springframework.http.HttpStatus;

import com.markcamp.backend.common.ApiException;
import com.markcamp.backend.common.ProblemCode;

/**
 * The event does not exist on this site. One response whether it is missing or on another site or project.
 */
class BaitSiteEventNotFoundException extends ApiException {

	BaitSiteEventNotFoundException() {
		super(HttpStatus.NOT_FOUND, ProblemCode.BAIT_SITE_EVENT_NOT_FOUND, "Bait site event not found.");
	}

}
