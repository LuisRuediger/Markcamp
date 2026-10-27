package com.markcamp.backend.user;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.simple.JdbcClient;

@SpringBootTest
class UserProvisioningServiceConcurrencyTest {

	private static final int THREADS = 8;

	@Autowired
	UserProvisioningService provisioningService;

	@Autowired
	JdbcClient jdbcClient;

	private final String subject = "test-" + UUID.randomUUID();

	@AfterEach
	void deleteTestUser() {
		this.jdbcClient.sql("DELETE FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject = ?")
			.param(this.subject)
			.update();
	}

	@Test
	void concurrentFirstRequestsCreateOneUser() throws Exception {
		CountDownLatch ready = new CountDownLatch(THREADS);
		CountDownLatch start = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(THREADS);
		try {
			List<Future<UUID>> results = new ArrayList<>();
			for (int i = 0; i < THREADS; i++) {
				results.add(executor.submit(() -> {
					ready.countDown();
					start.await();
					return this.provisioningService.provision(AuthProvider.FIREBASE, this.subject);
				}));
			}
			// Release all threads at the same moment, once every one of them is waiting.
			ready.await();
			start.countDown();

			Set<UUID> ids = new HashSet<>();
			for (Future<UUID> result : results) {
				ids.add(result.get(30, TimeUnit.SECONDS));
			}

			assertThat(ids).hasSize(1);
			assertThat(this.jdbcClient
				.sql("SELECT count(*) FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject = ?")
				.param(this.subject)
				.query(Integer.class)
				.single()).isEqualTo(1);
		}
		finally {
			executor.shutdownNow();
		}
	}

}
