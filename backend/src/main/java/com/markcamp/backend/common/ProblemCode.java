package com.markcamp.backend.common;

/**
 * The stable contract clients compare against (ADR 0006). Once published, a code is never renamed or reused.
 */
public enum ProblemCode {

	MALFORMED_REQUEST,
	VALIDATION_FAILED,
	FORBIDDEN,
	PROJECT_NOT_FOUND,
	RESOURCE_NOT_FOUND,
	METHOD_NOT_ALLOWED,
	ID_ALREADY_EXISTS,
	UNSUPPORTED_MEDIA_TYPE,
	INVALID_REQUEST,
	INTERNAL_ERROR

}
