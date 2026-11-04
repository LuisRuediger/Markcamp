package com.markcamp.backend.baitsite;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.util.Assert;

import com.markcamp.backend.common.FieldCode;
import com.markcamp.backend.common.InvalidField;

/**
 * The rules for {@code occurred_at}, a client-supplied instant (ADR 0005, rule 2).
 */
@Component
class OccurredAtValidator {

	// Java accepts years Postgres cannot store, and an input that always produces a 5xx would be retried forever by the
	// sync queue. Also catches phones with a reset clock (1970). Fixed in code, not configurable.
	private static final Instant EARLIEST = Instant.parse("2000-01-01T00:00:00Z");

	private static final int NANOS_PER_MICRO = 1000;

	private final Clock clock;

	private final Duration maxClockSkew;

	OccurredAtValidator(Clock clock, @Value("${markcamp.events.max-clock-skew}") Duration maxClockSkew) {
		Assert.isTrue(!maxClockSkew.isNegative(), "markcamp.events.max-clock-skew must not be negative");
		this.clock = clock;
		this.maxClockSkew = maxClockSkew;
	}

	/**
	 * Returns the instant, or null after adding to {@code invalidFields} under {@code field}, the name in the JSON body.
	 */
	Instant validate(String value, String field, List<InvalidField> invalidFields) {
		if (value == null) {
			invalidFields.add(new InvalidField(field, FieldCode.REQUIRED));
			return null;
		}
		OffsetDateTime parsed;
		try {
			// The offset is required: without one the server would read it in its own time zone and silently shift the
			// event by hours.
			parsed = OffsetDateTime.parse(value, DateTimeFormatter.ISO_OFFSET_DATE_TIME);
		}
		catch (DateTimeParseException ex) {
			invalidFields.add(new InvalidField(field, FieldCode.INVALID_FORMAT));
			return null;
		}
		// Postgres stores microseconds and would round silently; same rule as accept-float-as-int=false: never change a
		// value without saying so.
		if (parsed.getNano() % NANOS_PER_MICRO != 0) {
			invalidFields.add(new InvalidField(field, FieldCode.INVALID_FORMAT));
			return null;
		}
		Instant occurredAt = parsed.toInstant();
		if (occurredAt.isBefore(EARLIEST) || occurredAt.isAfter(this.clock.instant().plus(this.maxClockSkew))) {
			invalidFields.add(new InvalidField(field, FieldCode.OUT_OF_RANGE));
			return null;
		}
		return occurredAt;
	}

}
