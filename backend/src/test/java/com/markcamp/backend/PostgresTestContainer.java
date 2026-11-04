package com.markcamp.backend;

import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * The one disposable Postgres of a test run. Every {@code @SpringBootTest} class implements this interface.
 * <p>
 * A static field, not a {@code @Bean} in a test configuration: a bean belongs to an application context, the test
 * classes use more than one context, and closing a context closes its beans. A static field is initialized once per
 * JVM. Nothing stops the container explicitly; Testcontainers' Ryuk removes it when the JVM exits.
 */
public interface PostgresTestContainer {

	// Same image as docker-compose.yml, so tests and dev never run different Postgres versions.
	String IMAGE = "postgres:17";

	@ServiceConnection
	PostgreSQLContainer POSTGRES = start();

	// Started here because @ServiceConnection only reads the field, and a stopped container has no JDBC URL to give.
	private static PostgreSQLContainer start() {
		PostgreSQLContainer container = new PostgreSQLContainer(IMAGE);
		container.start();
		return container;
	}

}
