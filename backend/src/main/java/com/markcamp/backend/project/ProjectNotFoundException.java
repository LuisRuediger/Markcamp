package com.markcamp.backend.project;

import org.springframework.http.HttpStatus;

import com.markcamp.backend.common.ApiException;
import com.markcamp.backend.common.ProblemCode;

/**
 * The project does not exist or the caller is not a member. One response for both, so it never confirms that a project
 * exists (ADR 0006, rule 5).
 */
public class ProjectNotFoundException extends ApiException {

	public ProjectNotFoundException() {
		super(HttpStatus.NOT_FOUND, ProblemCode.PROJECT_NOT_FOUND, "Project not found.");
	}

}
