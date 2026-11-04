package com.markcamp.backend.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import java.util.Objects;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.simple.JdbcClient;

import com.markcamp.backend.PostgresTestContainer;

/**
 * An exception that escapes is logged with its stack trace (ADR 0006), so its text must say which constraint failed
 * without carrying the failing row: names and coordinates are never logged.
 */
@SpringBootTest
@ExtendWith(OutputCaptureExtension.class)
class DatabaseErrorDetailTest implements PostgresTestContainer {

	private static final Logger log = LoggerFactory.getLogger(DatabaseErrorDetailTest.class);

	private static final String NAME = "secret-site-name-7f3a";

	private static final String LONGITUDE = "-49.123456";

	private static final String CONSTRAINT = "bait_sites_latitude_check";

	@Autowired
	JdbcClient jdbcClient;

	@Test
	void constraintViolationReportsTheConstraintButNotTheRow(CapturedOutput output) {
		// Random project and creator: Postgres checks CHECK constraints before foreign keys.
		Throwable thrown = catchThrowable(() -> this.jdbcClient
			.sql("INSERT INTO bait_sites (id, project_id, name, latitude, longitude, created_by) VALUES (?, ?, ?, ?, ?, ?)")
			.params(UUID.randomUUID(), UUID.randomUUID(), NAME, 91.0, Double.parseDouble(LONGITUDE), UUID.randomUUID())
			.update());
		// Same call as ApiExceptionHandler, because nothing has logged the exception up to here.
		log.error("Unhandled exception: path={}", "/test", thrown);

		String messages = Stream.iterate(thrown, Objects::nonNull, Throwable::getCause)
			.map(Throwable::getMessage)
			.collect(Collectors.joining("\n"));
		assertThat(messages).contains(CONSTRAINT).doesNotContain(NAME, LONGITUDE);
		assertThat(output.getAll()).contains(CONSTRAINT).doesNotContain(NAME, LONGITUDE);
	}

}
