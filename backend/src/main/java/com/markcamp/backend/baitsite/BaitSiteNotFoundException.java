package com.markcamp.backend.baitsite;

import org.springframework.http.HttpStatus;

import com.markcamp.backend.common.ApiException;
import com.markcamp.backend.common.ProblemCode;

/**
 * The site does not exist in this project. One response whether it is missing or in another project.
 */
class BaitSiteNotFoundException extends ApiException {

	BaitSiteNotFoundException() {
		super(HttpStatus.NOT_FOUND, ProblemCode.BAIT_SITE_NOT_FOUND, "Bait site not found.");
	}

}
