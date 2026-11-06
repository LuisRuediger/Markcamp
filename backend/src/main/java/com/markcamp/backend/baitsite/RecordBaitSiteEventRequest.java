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
import com.markcamp.backend.species.SpeciesCatalog;

/**
 * All Strings, so that a bad value is a field error, not an unreadable body (ADR 0006).
 */
record RecordBaitSiteEventRequest(String id, String type, String occurredAt, String speciesId,
		String identifiedEventId) {

	// A list instead of valueOf on raw input, so a new enum constant is not accepted by accident.
	private static final Map<String, BaitSiteEventType> RECORDABLE_TYPES = Stream
		.of(BaitSiteEventType.INSTALLED, BaitSiteEventType.ACTIVITY, BaitSiteEventType.CAPTURED, BaitSiteEventType.LOST,
				BaitSiteEventType.COLLECTED, BaitSiteEventType.REMOVED, BaitSiteEventType.INSPECTED,
				BaitSiteEventType.IDENTIFIED)
		.collect(Collectors.toUnmodifiableMap(Enum::name, Function.identity()));

	record Validated(UUID id, BaitSiteEventType type, Instant occurredAt, UUID speciesId, UUID identifiedEventId) {
	}

	/**
	 * Reports all invalid fields at once (ADR 0006).
	 */
	Validated validate(OccurredAtValidator occurredAtValidator, SpeciesCatalog speciesCatalog) {
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

		// Without a valid type we cannot know which rules apply to these two, so only the type is reported.
		UUID parsedSpeciesId = null;
		UUID parsedIdentifiedEventId = null;
		if (parsedType != null) {
			parsedSpeciesId = validateSpeciesId(parsedType, speciesCatalog, invalidFields);
			parsedIdentifiedEventId = validateIdentifiedEventId(parsedType, parsedId, invalidFields);
		}

		if (!invalidFields.isEmpty()) {
			throw new RequestValidationException(invalidFields);
		}
		return new Validated(parsedId.orElseThrow(), parsedType, parsedOccurredAt, parsedSpeciesId,
				parsedIdentifiedEventId);
	}

	/**
	 * Returns the species, or null when there is none or after adding to {@code invalidFields}.
	 * <p>
	 * Existence is a field rule because the foreign key would turn an unknown species into a 500, and no client input may
	 * produce a deterministic 5xx. It can run before the site lock: species are global and never deleted, so there is no
	 * race.
	 */
	private UUID validateSpeciesId(BaitSiteEventType eventType, SpeciesCatalog speciesCatalog,
			List<InvalidField> invalidFields) {
		if (eventType != BaitSiteEventType.CAPTURED && eventType != BaitSiteEventType.IDENTIFIED) {
			if (this.speciesId != null) {
				invalidFields.add(new InvalidField("speciesId", FieldCode.NOT_ALLOWED));
			}
			return null;
		}
		if (eventType == BaitSiteEventType.IDENTIFIED && UnicodeSpaces.isNullOrBlank(this.speciesId)) {
			invalidFields.add(new InvalidField("speciesId", FieldCode.REQUIRED));
			return null;
		}
		// Only null means unidentified on a CAPTURED; a blank string falls through to the parser and is a bad format.
		if (this.speciesId == null) {
			return null;
		}
		// Species ids are UUID v7 literals (ADR 0005, rule 6), so the same strict parser applies.
		Optional<UUID> known = UuidV7.parseClientId(this.speciesId).filter(speciesCatalog::exists);
		if (known.isEmpty()) {
			invalidFields.add(new InvalidField("speciesId", FieldCode.INVALID_FORMAT));
			return null;
		}
		return known.get();
	}

	/**
	 * Returns the target, or null when there is none or after adding to {@code invalidFields}.
	 * <p>
	 * Pointing to itself is a field rule so that it never reaches the CHECK constraint, which would be a 500. Compared as
	 * parsed UUIDs: the same id in upper case is the same row.
	 */
	private UUID validateIdentifiedEventId(BaitSiteEventType eventType, Optional<UUID> parsedId,
			List<InvalidField> invalidFields) {
		if (eventType != BaitSiteEventType.IDENTIFIED) {
			if (this.identifiedEventId != null) {
				invalidFields.add(new InvalidField("identifiedEventId", FieldCode.NOT_ALLOWED));
			}
			return null;
		}
		if (UnicodeSpaces.isNullOrBlank(this.identifiedEventId)) {
			invalidFields.add(new InvalidField("identifiedEventId", FieldCode.REQUIRED));
			return null;
		}
		Optional<UUID> target = UuidV7.parseClientId(this.identifiedEventId);
		if (target.isEmpty() || target.equals(parsedId)) {
			invalidFields.add(new InvalidField("identifiedEventId", FieldCode.INVALID_FORMAT));
			return null;
		}
		return target.get();
	}

}
