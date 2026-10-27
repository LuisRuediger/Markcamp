package com.markcamp.backend.common;

import java.util.UUID;

import com.fasterxml.uuid.Generators;
import com.fasterxml.uuid.impl.TimeBasedEpochGenerator;

/**
 * Single source of server-generated ids (ADR 0002). Java has no UUID v7, so this wraps java-uuid-generator.
 */
public final class UuidV7 {

	// Thread-safe: the generator synchronizes internally, so one shared instance is enough.
	private static final TimeBasedEpochGenerator GENERATOR = Generators.timeBasedEpochGenerator();

	private UuidV7() {
	}

	public static UUID generate() {
		return GENERATOR.generate();
	}

}
