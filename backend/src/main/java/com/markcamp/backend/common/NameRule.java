package com.markcamp.backend.common;

import java.util.List;

/**
 * The rule for user-given names (projects, bait sites).
 */
public final class NameRule {

	private NameRule() {
	}

	/**
	 * Returns the trimmed name. If it is invalid, also adds to {@code invalidFields} under {@code field}, the name in the
	 * JSON body, and the caller must not use the returned value.
	 */
	public static String validate(String value, int maxLength, String field, List<InvalidField> invalidFields) {
		String trimmed = (value != null) ? UnicodeSpaces.trim(value) : "";
		if (trimmed.isEmpty()) {
			invalidFields.add(new InvalidField(field, FieldCode.REQUIRED));
		}
		// Single-line display text. Postgres also rejects NUL, and a 5xx would be retried forever by the sync queue.
		else if (trimmed.codePoints().anyMatch(Character::isISOControl)) {
			invalidFields.add(new InvalidField(field, FieldCode.INVALID_FORMAT));
		}
		// Code points, not length(): Postgres char_length counts characters, Java length() counts UTF-16 units, so an
		// emoji would count twice.
		else if (trimmed.codePointCount(0, trimmed.length()) > maxLength) {
			invalidFields.add(new InvalidField(field, FieldCode.TOO_LONG));
		}
		return trimmed;
	}

}
