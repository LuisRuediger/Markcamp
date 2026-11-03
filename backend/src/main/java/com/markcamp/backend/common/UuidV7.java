package com.markcamp.backend.common;

import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.impl.TimeBasedEpochGenerator;

/**
 * Single source of server-generated ids and parser of client-supplied ones (ADR 0002). Java has no UUID v7, so this
 * wraps java-uuid-generator.
 */
public final class UuidV7 {

	// Thread-safe: the generator synchronizes internally, so one shared instance is enough.
	private static final TimeBasedEpochGenerator GENERATOR = Generators.timeBasedEpochGenerator();

	private static final Pattern CANONICAL_V7 = Pattern
		.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-7[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}");

	private UuidV7() {
	}

	public static UUID generate() {
		return GENERATOR.generate();
	}

	/**
	 * Parses an untrusted id (ADR 0002, rule 2). The embedded timestamp is not checked.
	 */
	public static Optional<UUID> parseClientId(String value) {
		// The format comes first because UUID.fromString alone accepts non-canonical input such as 1-1-1-1-1.
		if (value == null || !CANONICAL_V7.matcher(value).matches()) {
			return Optional.empty();
		}
		return Optional.of(UUID.fromString(value));
	}

}
