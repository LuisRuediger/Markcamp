package com.markcamp.backend.common;

import org.springframework.http.HttpStatus;

/**
 * A create used a client-generated id that is already taken. Never an overwrite (ADR 0002, rule 2).
 */
public class IdAlreadyExistsException extends ApiException {

	public IdAlreadyExistsException() {
		super(HttpStatus.CONFLICT, ProblemCode.ID_ALREADY_EXISTS, "A resource with this id already exists.");
	}

}
