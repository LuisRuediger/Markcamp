package com.markcamp.backend.project;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.markcamp.backend.common.FieldCode;
import com.markcamp.backend.common.InvalidField;
import com.markcamp.backend.common.RequestValidationException;
import com.markcamp.backend.common.UuidV7;

/**
 * The id is a String so that a bad one is a field error, not an unreadable body (ADR 0006).
 */
record CreateProjectRequest(String id, String name) {

	private static final int NAME_MAX_LENGTH = 100;

	record Validated(UUID id, String name) {
	}

	/**
	 * Reports all invalid fields at once (ADR 0006).
	 */
	Validated validate() {
		List<InvalidField> invalidFields = new ArrayList<>();

		Optional<UUID> parsedId = UuidV7.parseClientId(this.id);
		if (this.id == null) {
			invalidFields.add(new InvalidField("id", FieldCode.REQUIRED));
		}
		else if (parsedId.isEmpty()) {
			invalidFields.add(new InvalidField("id", FieldCode.INVALID_FORMAT));
		}

		String trimmedName = (this.name != null) ? trimSpaces(this.name) : "";
		if (trimmedName.isEmpty()) {
			invalidFields.add(new InvalidField("name", FieldCode.REQUIRED));
		}
		// Single-line display text. Postgres also rejects NUL, and a 5xx would be retried forever by the sync queue.
		else if (trimmedName.codePoints().anyMatch(Character::isISOControl)) {
			invalidFields.add(new InvalidField("name", FieldCode.INVALID_FORMAT));
		}
		// Code points, not length(): Postgres char_length counts characters, Java length() counts UTF-16 units, so an
		// emoji would count twice.
		else if (trimmedName.codePointCount(0, trimmedName.length()) > NAME_MAX_LENGTH) {
			invalidFields.add(new InvalidField("name", FieldCode.TOO_LONG));
		}

		if (!invalidFields.isEmpty()) {
			throw new RequestValidationException(invalidFields);
		}
		return new Validated(parsedId.orElseThrow(), trimmedName);
	}

	// One definition of "space" for both trimming and blank names; strip() alone would leave NBSP at the ends.
	private static String trimSpaces(String value) {
		int start = 0;
		int end = value.length();
		while (start < end && isSpace(value.charAt(start))) {
			start++;
		}
		while (end > start && isSpace(value.charAt(end - 1))) {
			end--;
		}
		return value.substring(start, end);
	}

	private static boolean isSpace(char character) {
		return Character.isWhitespace(character) || Character.isSpaceChar(character);
	}

}
