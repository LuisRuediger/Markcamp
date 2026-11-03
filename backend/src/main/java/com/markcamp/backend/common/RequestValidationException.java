package com.markcamp.backend.common;

import java.util.List;

import org.springframework.http.HttpStatus;

public class RequestValidationException extends ApiException {

	private final List<InvalidField> invalidFields;

	public RequestValidationException(List<InvalidField> invalidFields) {
		super(HttpStatus.BAD_REQUEST, ProblemCode.VALIDATION_FAILED, "Request validation failed.");
		this.invalidFields = List.copyOf(invalidFields);
	}

	public List<InvalidField> getInvalidFields() {
		return this.invalidFields;
	}

}
