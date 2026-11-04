package com.markcamp.backend.project;

import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.markcamp.backend.common.FieldCode;
import com.markcamp.backend.common.InvalidField;
import com.markcamp.backend.common.NameRule;
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

		String trimmedName = NameRule.validate(this.name, NAME_MAX_LENGTH, "name", invalidFields);

		if (!invalidFields.isEmpty()) {
			throw new RequestValidationException(invalidFields);
		}
		return new Validated(parsedId.orElseThrow(), trimmedName);
	}

}
