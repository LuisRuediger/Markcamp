package com.markcamp.backend.common;

/**
 * Why a field is invalid. Our own codes, so the API contract does not depend on how validation is implemented (ADR 0006).
 */
public enum FieldCode {

	REQUIRED,
	TOO_LONG,
	INVALID_FORMAT,
	OUT_OF_RANGE

}
