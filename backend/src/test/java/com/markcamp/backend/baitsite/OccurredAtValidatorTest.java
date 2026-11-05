package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import com.markcamp.backend.common.FieldCode;
import com.markcamp.backend.common.InvalidField;

class OccurredAtValidatorTest {

	private static final String FIELD = "installation.occurredAt";

	private static final Instant NOW = Instant.parse("2026-11-03T12:00:00Z");

	private final OccurredAtValidator validator = new OccurredAtValidator(Clock.fixed(NOW, ZoneOffset.UTC),
			Duration.ofMinutes(10));

	private final List<InvalidField> invalidFields = new ArrayList<>();

	@Test
	void withinClockSkewIsAccepted() {
		assertAccepted("2026-11-03T12:09:00Z", Instant.parse("2026-11-03T12:09:00Z"));
	}

	@Test
	void exactlyAtClockSkewIsAccepted() {
		assertAccepted("2026-11-03T12:10:00Z", Instant.parse("2026-11-03T12:10:00Z"));
	}

	@Test
	void beyondClockSkewIsOutOfRange() {
		assertRejected("2026-11-03T12:11:00Z", FieldCode.OUT_OF_RANGE);
	}

	@Test
	void pastIsAccepted() {
		assertAccepted("2026-01-15T08:00:00Z", Instant.parse("2026-01-15T08:00:00Z"));
	}

	@Test
	void earliestInstantIsAccepted() {
		assertAccepted("2000-01-01T00:00:00Z", Instant.parse("2000-01-01T00:00:00Z"));
	}

	@Test
	void justBeforeEarliestInstantIsOutOfRange() {
		assertRejected("1999-12-31T23:59:59Z", FieldCode.OUT_OF_RANGE);
	}

	// The instant counts, not the local time on the wall: this reads 2000-01-01 but is still 1999 in UTC.
	@Test
	void earliestInstantIsComparedInUtc() {
		assertRejected("2000-01-01T00:30:00+01:00", FieldCode.OUT_OF_RANGE);
	}

	@Test
	void resetPhoneClockIsOutOfRange() {
		assertRejected("1970-01-01T00:00:00Z", FieldCode.OUT_OF_RANGE);
	}

	// Parses in Java, but Postgres cannot store it.
	@Test
	void yearPostgresCannotStoreIsOutOfRange() {
		assertRejected("+999999999-12-31T23:59:59Z", FieldCode.OUT_OF_RANGE);
		this.invalidFields.clear();
		assertRejected("-999999999-01-01T00:00:00Z", FieldCode.OUT_OF_RANGE);
	}

	@Test
	void missingOffsetIsInvalidFormat() {
		assertRejected("2026-11-03T09:20:00", FieldCode.INVALID_FORMAT);
	}

	@Test
	void utcAndOffsetDenotingTheSameInstantAreTheSame() {
		Instant expected = Instant.parse("2026-11-03T11:20:00Z");

		assertAccepted("2026-11-03T11:20:00Z", expected);
		assertAccepted("2026-11-03T08:20:00-03:00", expected);
	}

	@Test
	void sixFractionDigitsAreAccepted() {
		assertAccepted("2026-11-03T09:20:00.123456Z", Instant.parse("2026-11-03T09:20:00.123456Z"));
	}

	@Test
	void sevenNonZeroFractionDigitsAreInvalidFormat() {
		assertRejected("2026-11-03T09:20:00.1234567Z", FieldCode.INVALID_FORMAT);
	}

	@ParameterizedTest
	@ValueSource(strings = { "garbage", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-11-03", "1730000000" })
	void garbageIsInvalidFormat(String value) {
		assertRejected(value, FieldCode.INVALID_FORMAT);
	}

	@Test
	void nullIsRequired() {
		assertRejected(null, FieldCode.REQUIRED);
	}

	@ParameterizedTest
	@ValueSource(strings = { "", "   ", " ", " " })
	void blankIsRequired(String value) {
		assertRejected(value, FieldCode.REQUIRED);
	}

	// Machine data is not trimmed: a padded value is a client bug we want to see.
	@Test
	void validInstantWithSpacesAroundItIsInvalidFormat() {
		assertRejected(" 2026-11-03T09:20:00Z ", FieldCode.INVALID_FORMAT);
	}

	@Test
	void negativeClockSkewFailsAtStartup() {
		assertThatThrownBy(() -> new OccurredAtValidator(Clock.systemUTC(), Duration.ofMinutes(-1)))
			.isInstanceOf(IllegalArgumentException.class);
	}

	private void assertAccepted(String value, Instant expected) {
		assertThat(this.validator.validate(value, FIELD, this.invalidFields)).isEqualTo(expected);
		assertThat(this.invalidFields).isEmpty();
	}

	private void assertRejected(String value, FieldCode expected) {
		assertThat(this.validator.validate(value, FIELD, this.invalidFields)).isNull();
		assertThat(this.invalidFields).containsExactly(new InvalidField(FIELD, expected));
	}

}
