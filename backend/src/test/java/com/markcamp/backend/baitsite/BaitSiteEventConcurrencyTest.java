package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.markcamp.backend.PostgresTestContainer;
import com.markcamp.backend.TestTokens;
import com.markcamp.backend.common.UuidV7;

/**
 * This test fails without the FOR UPDATE of {@link BaitSiteRepository#lockInProject}. Each transaction alone is valid, so
 * only the lock can make the others see the INSTALLED of the first.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class BaitSiteEventConcurrencyTest implements PostgresTestContainer {

	private static final int THREADS = 8;

	@TestBean(methodName = "com.markcamp.backend.TestTokens#jwtDecoder")
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JdbcClient jdbcClient;

	@Test
	void concurrentInstallsOnAnEmptySiteRecordExactlyOne() throws Exception {
		String subject = "test-" + UUID.randomUUID();
		String token = TestTokens.trusted(subject);
		String projectId = UuidV7.generate().toString();
		String projects = "/api/projects";
		assertThat(postJson(token, projects, "{\"id\": \"%s\", \"name\": \"Project\"}".formatted(projectId)).getStatus())
			.isEqualTo(201);
		String sites = projects + "/" + projectId + "/bait-sites";
		String siteId = UuidV7.generate().toString();
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		assertThat(postJson(token, sites, """
				{"id": "%s", "name": "Isca 31", "latitude": -26.9, "longitude": -49.0,
				"installation": {"id": "%s", "occurredAt": "%s"}}
				""".formatted(siteId, UuidV7.generate(), now.minusHours(2))).getStatus()).isEqualTo(201);
		String events = sites + "/" + siteId + "/events";
		assertThat(postJson(token, events, eventBody("REMOVED", now.minusHours(1))).getStatus()).isEqualTo(201);

		CountDownLatch ready = new CountDownLatch(THREADS);
		CountDownLatch start = new CountDownLatch(1);
		ExecutorService executor = Executors.newFixedThreadPool(THREADS);
		try {
			List<Future<MockHttpServletResponse>> results = new ArrayList<>();
			for (int i = 0; i < THREADS; i++) {
				String body = eventBody("INSTALLED", now.minusMinutes(1));
				results.add(executor.submit(() -> {
					ready.countDown();
					start.await();
					return postJson(token, events, body);
				}));
			}
			// Release all threads at the same moment, once every one of them is waiting.
			ready.await();
			start.countDown();

			List<MockHttpServletResponse> responses = new ArrayList<>();
			for (Future<MockHttpServletResponse> result : results) {
				responses.add(result.get(30, TimeUnit.SECONDS));
			}

			assertThat(responses.stream().filter((response) -> response.getStatus() == 201)).hasSize(1);
			assertThat(responses.stream().filter((response) -> response.getStatus() != 201)).hasSize(THREADS - 1)
				.allSatisfy((response) -> {
					assertThat(response.getStatus()).isEqualTo(409);
					String body = response.getContentAsString(StandardCharsets.UTF_8);
					assertThat(JsonPath.<String>read(body, "$.code")).isEqualTo("INVALID_EVENT_SEQUENCE");
				});
			// The one from the creation of the site, plus exactly one new.
			assertThat(this.jdbcClient
				.sql("SELECT count(*) FROM bait_site_events WHERE bait_site_id = ?::uuid AND event_type = 'INSTALLED'")
				.param(siteId)
				.query(Long.class)
				.single()).isEqualTo(2);
		}
		finally {
			executor.shutdownNow();
		}
	}

	private MockHttpServletResponse postJson(String token, String path, String body) throws Exception {
		return this.mockMvc
			.perform(post(path)
				.contentType(MediaType.APPLICATION_JSON)
				.content(body)
				.header("Authorization", "Bearer " + token))
			.andReturn()
			.getResponse();
	}

	private static String eventBody(String type, OffsetDateTime occurredAt) {
		return "{\"id\": \"%s\", \"type\": \"%s\", \"occurredAt\": \"%s\"}".formatted(UuidV7.generate(), type, occurredAt);
	}

}
