package com.markcamp.backend.baitsite;

import org.springframework.http.HttpStatus;

import com.markcamp.backend.common.ApiException;
import com.markcamp.backend.common.ProblemCode;

/**
 * The event, or voiding an event, would make the history of the site invalid (ADR 0005). Unchecked, so
 * {@code @Transactional} rolls back the insert or void that came before the check.
 */
class InvalidEventSequenceException extends ApiException {

	InvalidEventSequenceException() {
		super(HttpStatus.CONFLICT, ProblemCode.INVALID_EVENT_SEQUENCE,
				"The request would leave the history of this bait site invalid.");
	}

}
