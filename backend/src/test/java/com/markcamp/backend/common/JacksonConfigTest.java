package com.markcamp.backend.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

import tools.jackson.databind.exc.MismatchedInputException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Pins the rule on the mapper Boot builds from the application's properties, before any endpoint accepts a number or a
 * boolean. No database: this slice only starts Jackson.
 */
@JsonTest
class JacksonConfigTest {

	@Autowired
	JsonMapper jsonMapper;

	@Test
	void realJsonTypesAreAccepted() {
		assertThat(this.jsonMapper.readValue("{\"count\": 5}", IntField.class).count()).isEqualTo(5);
		assertThat(this.jsonMapper.readValue("{\"active\": true}", BooleanField.class).active()).isTrue();
	}

	// Latitude and longitude depend on this: a whole number is a valid JSON number for a double.
	@Test
	void integerIsAcceptedForDouble() {
		assertThat(this.jsonMapper.readValue("{\"value\": -27}", DoubleField.class).value()).isEqualTo(-27.0);
	}

	@Test
	void floatIsRejectedForInt() {
		assertThatThrownBy(() -> this.jsonMapper.readValue("{\"count\": 5.5}", IntField.class))
			.isInstanceOf(MismatchedInputException.class);
	}

	@Test
	void stringIsRejectedForInt() {
		assertThatThrownBy(() -> this.jsonMapper.readValue("{\"count\": \"5\"}", IntField.class))
			.isInstanceOf(MismatchedInputException.class);
	}

	@Test
	void stringIsRejectedForBoolean() {
		assertThatThrownBy(() -> this.jsonMapper.readValue("{\"active\": \"true\"}", BooleanField.class))
			.isInstanceOf(MismatchedInputException.class);
	}

	record IntField(int count) {
	}

	record BooleanField(boolean active) {
	}

	record DoubleField(double value) {
	}

}
