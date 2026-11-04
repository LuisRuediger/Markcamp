package com.markcamp.backend.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class NameRuleTest {

	private static final int MAX_LENGTH = 5;

	private static final String FIELD = "someName";

	private static final String NBSP = " ";

	private static final String IDEOGRAPHIC_SPACE = "　";

	private final List<InvalidField> invalidFields = new ArrayList<>();

	@Test
	void trimsAsciiAndUnicodeSpacesAtTheEnds() {
		assertThat(validate(" " + NBSP + "Isca" + IDEOGRAPHIC_SPACE + "\t")).isEqualTo("Isca");
		assertThat(this.invalidFields).isEmpty();
	}

	@Test
	void keepsUnicodeSpaceInsideName() {
		assertThat(validate("a" + NBSP + "b")).isEqualTo("a" + NBSP + "b");
		assertThat(this.invalidFields).isEmpty();
	}

	@Test
	void nullIsRequired() {
		validate(null);

		assertThat(this.invalidFields).containsExactly(new InvalidField(FIELD, FieldCode.REQUIRED));
	}

	@ParameterizedTest
	@ValueSource(strings = { "", "   ", "  ", "　", "  \t\n" })
	void onlySpacesIsRequired(String value) {
		validate(value);

		assertThat(this.invalidFields).containsExactly(new InvalidField(FIELD, FieldCode.REQUIRED));
	}

	@ParameterizedTest
	@ValueSource(strings = { "a\u0000b", "a\nb", "a\tb", "a\u007Fb" })
	void controlCharacterInsideNameIsInvalidFormat(String value) {
		validate(value);

		assertThat(this.invalidFields).containsExactly(new InvalidField(FIELD, FieldCode.INVALID_FORMAT));
	}

	@Test
	void maxLengthIsAccepted() {
		validate("a".repeat(MAX_LENGTH));

		assertThat(this.invalidFields).isEmpty();
	}

	@Test
	void overMaxLengthIsTooLong() {
		validate("a".repeat(MAX_LENGTH + 1));

		assertThat(this.invalidFields).containsExactly(new InvalidField(FIELD, FieldCode.TOO_LONG));
	}

	@Test
	void lengthIsCheckedAfterTrimming() {
		validate("  " + "a".repeat(MAX_LENGTH) + "  ");

		assertThat(this.invalidFields).isEmpty();
	}

	// Each emoji is two UTF-16 units, so length() would say 10 and wrongly reject it.
	@Test
	void emojiCountsAsOneCharacter() {
		validate("🐝".repeat(MAX_LENGTH));

		assertThat(this.invalidFields).isEmpty();
	}

	@Test
	void emojiOverMaxLengthIsTooLong() {
		validate("🐝".repeat(MAX_LENGTH + 1));

		assertThat(this.invalidFields).containsExactly(new InvalidField(FIELD, FieldCode.TOO_LONG));
	}

	private String validate(String value) {
		return NameRule.validate(value, MAX_LENGTH, FIELD, this.invalidFields);
	}

}
