package com.markcamp.backend.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class UuidV7Test {

	@Test
	void acceptsGeneratedV7InLowerAndUpperCase() {
		UUID id = UuidV7.generate();

		assertThat(UuidV7.parseClientId(id.toString())).contains(id);
		assertThat(UuidV7.parseClientId(id.toString().toUpperCase(Locale.ROOT))).contains(id);
	}

	@Test
	void rejectsV4() {
		assertThat(UuidV7.parseClientId(UUID.randomUUID().toString())).isEmpty();
	}

	@Test
	void rejectsV7WithWrongVariant() {
		StringBuilder id = new StringBuilder(UuidV7.generate().toString());
		id.setCharAt(19, 'c');

		assertThat(UuidV7.parseClientId(id.toString())).isEmpty();
	}

	@Test
	void rejectsNonCanonicalFormThatUuidFromStringAccepts() {
		assertThat(UUID.fromString("1-1-1-1-1")).isNotNull();

		assertThat(UuidV7.parseClientId("1-1-1-1-1")).isEmpty();
	}

	@Test
	void rejectsStringWithoutDashes() {
		assertThat(UuidV7.parseClientId(UuidV7.generate().toString().replace("-", ""))).isEmpty();
	}

	@Test
	void rejectsEmptyString() {
		assertThat(UuidV7.parseClientId("")).isEmpty();
	}

}
