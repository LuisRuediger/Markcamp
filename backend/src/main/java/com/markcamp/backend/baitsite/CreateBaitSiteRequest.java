package com.markcamp.backend.baitsite;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.markcamp.backend.common.FieldCode;
import com.markcamp.backend.common.InvalidField;
import com.markcamp.backend.common.NameRule;
import com.markcamp.backend.common.RequestValidationException;
import com.markcamp.backend.common.UnicodeSpaces;
import com.markcamp.backend.common.UuidV7;

/**
 * Ids and dates are Strings so that a bad one is a field error, not an unreadable body (ADR 0006). Coordinates are
 * Double because a primitive double turns a missing field into 0.0, a point in the Gulf of Guinea.
 */
record CreateBaitSiteRequest(String id, String name, Double latitude, Double longitude, Double locationAccuracyM,
		Installation installation) {

	private static final int NAME_MAX_LENGTH = 60;

	/**
	 * Both ids come from the client (ADR 0002): an offline client must know the id of the INSTALLED event before sync,
	 * e.g. to void it later.
	 */
	record Installation(String id, String occurredAt) {
	}

	record Validated(UUID id, String name, double latitude, double longitude, Double locationAccuracyM,
			UUID installationId, Instant installationOccurredAt) {
	}

	/**
	 * Reports all invalid fields at once (ADR 0006).
	 */
	Validated validate(OccurredAtValidator occurredAtValidator) {
		List<InvalidField> invalidFields = new ArrayList<>();

		Optional<UUID> parsedId = parseId(this.id, "id", invalidFields);
		String trimmedName = NameRule.validate(this.name, NAME_MAX_LENGTH, "name", invalidFields);
		validateRange(this.latitude, -90, 90, "latitude", invalidFields);
		validateRange(this.longitude, -180, 180, "longitude", invalidFields);

		// Infinity must be rejected by name: Infinity > 0 is true, and Postgres accepts it in double precision, so neither
		// the comparison nor the database CHECK would stop it.
		if (this.locationAccuracyM != null && !(Double.isFinite(this.locationAccuracyM) && this.locationAccuracyM > 0)) {
			invalidFields.add(new InvalidField("locationAccuracyM", FieldCode.OUT_OF_RANGE));
		}

		Optional<UUID> parsedInstallationId = Optional.empty();
		Instant occurredAt = null;
		if (this.installation == null) {
			invalidFields.add(new InvalidField("installation", FieldCode.REQUIRED));
		}
		else {
			parsedInstallationId = parseId(this.installation.id(), "installation.id", invalidFields);
			occurredAt = occurredAtValidator.validate(this.installation.occurredAt(), "installation.occurredAt",
					invalidFields);
		}

		if (!invalidFields.isEmpty()) {
			throw new RequestValidationException(invalidFields);
		}
		return new Validated(parsedId.orElseThrow(), trimmedName, this.latitude, this.longitude, this.locationAccuracyM,
				parsedInstallationId.orElseThrow(), occurredAt);
	}

	private static Optional<UUID> parseId(String value, String field, List<InvalidField> invalidFields) {
		Optional<UUID> parsed = UuidV7.parseClientId(value);
		if (UnicodeSpaces.isNullOrBlank(value)) {
			invalidFields.add(new InvalidField(field, FieldCode.REQUIRED));
		}
		else if (parsed.isEmpty()) {
			invalidFields.add(new InvalidField(field, FieldCode.INVALID_FORMAT));
		}
		return parsed;
	}

	private static void validateRange(Double value, double min, double max, String field,
			List<InvalidField> invalidFields) {
		if (value == null) {
			invalidFields.add(new InvalidField(field, FieldCode.REQUIRED));
		}
		// Written so that NaN fails: every comparison with NaN is false, so value < min || value > max would let it pass.
		else if (!(value >= min && value <= max)) {
			invalidFields.add(new InvalidField(field, FieldCode.OUT_OF_RANGE));
		}
	}

}
