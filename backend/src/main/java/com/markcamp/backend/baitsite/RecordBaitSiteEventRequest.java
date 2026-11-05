package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import com.markcamp.backend.common.FieldCode;
import com.markcamp.backend.common.InvalidField;
import com.markcamp.backend.common.RequestValidationException;
import com.markcamp.backend.common.UnicodeSpaces;
import com.markcamp.backend.common.UuidV7;

/**
 * All Strings, so that a bad value is a field error, not an unreadable body (ADR 0006).
 */
record RecordBaitSiteEventRequest(String id, String type, String occurredAt) {

	// A list instead of valueOf on raw input, so a new enum constant is not accepted by accident. No IDENTIFIED: it
	// needs a species and the capture it points to, and comes with slice B.
	private static final Map<String, BaitSiteEventType> RECORDABLE_TYPES = Stream
		.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.ACTIVITY, BaitSiteEventType.CAPTURED, BaitSiteEventType.LOST,
				BaitSiteEventType.COLLECTED, BaitSiteEventType.REMOVED, BaitSiteEventType.INSPECTED)
		.collect(Collectors.toUnmodifiableMap(Enum::name, Function.identity()));

	record Validated(UUID id, BaitSiteEventType type, Instant occurredAt) {
	}

	/**
	 * Reports all invalid fields at once (ADR 0006).
	 */
	Validated validate(OccurredAtValidator occurredAtValidator) {
		List<InvalidField> invalidFields = new ArrayList<>();

		Optional<UUID> parsedId = UuidV7.parseClientId(this.id);
		if (UnicodeSpaces.isNullOrBlank(this.id)) {
			invalidFields.add(new InvalidField("id", FieldCode.REQUIRED));
		}
		else if (parsedId.isEmpty()) {
			invalidFields.add(new InvalidField("id", FieldCode.INVALID_FORMAT));
		}

		BaitSiteEventType parsedType = null;
		if (UnicodeSpaces.isNullOrBlank(this.type)) {
			invalidFields.add(new InvalidField("type", FieldCode.REQUIRED));
		}
		else {
			parsedType = RECORDABLE_TYPES.get(this.type);
			if (parsedType == null) {
				invalidFields.add(new InvalidField("type", FieldCode.INVALID_FORMAT));
			}
		}

		Instant parsedOccurredAt = occurredAtValidator.validate(this.occurredAt, "occurredAt", invalidFields);

		if (!invalidFields.isEmpty()) {
			throw new RequestValidationException(invalidFields);
		}
		return new Validated(parsedId.orElseThrow(), parsedType, parsedOccurredAt);
	}

}
