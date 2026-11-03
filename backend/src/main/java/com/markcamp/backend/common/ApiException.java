package com.markcamp.backend.common;

import org.springframework.http.HttpStatus;

/**
 * An expected API error. {@code detail} goes to the client, so it must be a fixed sentence, never built from input.
 */
public abstract class ApiException extends RuntimeException {

	private final HttpStatus status;

	private final ProblemCode code;

	private final String detail;

	protected ApiException(HttpStatus status, ProblemCode code, String detail) {
		super(detail);
		this.status = status;
		this.code = code;
		this.detail = detail;
	}

	public HttpStatus getStatus() {
		return this.status;
	}

	public ProblemCode getCode() {
		return this.code;
	}

	public String getDetail() {
		return this.detail;
	}

}
