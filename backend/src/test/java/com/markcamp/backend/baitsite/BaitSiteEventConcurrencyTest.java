package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
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
 * The installs and the void against the IDENTIFIED fail without the FOR UPDATE of {@link BaitSiteRepository#lockInProject}:
 * each transaction alone is valid, so only the lock can make the others see what the first did.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ExtendWith(OutputCaptureExtension.class)
class BaitSiteEventConcurrencyTest implements PostgresTestContainer {

	private static final int THREADS = 8;

	// More than once because one attempt can finish in an order that hides the race.
	private static final int ROUNDS = 30;

	// Seeded by V2.
	private static final String JATAI = "01a17fce-7800-77ac-81e1-875a2a5b870c";

	@TestBean(methodName = "com.markcamp.backend.TestTokens#jwtDecoder")
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JdbcClient jdbcClient;

	@Test
	void concurrentInstallsOnAnEmptySiteRecordExactlyOne() throws Exception {
		String token = TestTokens.trusted("test-" + UUID.randomUUID());
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		String events = newSiteEvents(token, newSitesPath(token), now.minusHours(2));
		assertThat(postJson(token, events, eventBody(UuidV7.generate().toString(), "REMOVED", now.minusHours(1)))
			.getStatus()).isEqualTo(201);

		List<Callable<MockHttpServletResponse>> requests = new ArrayList<>();
		for (int i = 0; i < THREADS; i++) {
			String body = eventBody(UuidV7.generate().toString(), "INSTALLED", now.minusMinutes(1));
			requests.add(() -> postJson(token, events, body));
		}
		ExecutorService executor = Executors.newFixedThreadPool(THREADS);
		try {
			List<MockHttpServletResponse> responses = runTogether(executor, requests);

			assertThat(responses.stream().filter((response) -> response.getStatus() == 201)).hasSize(1);
			assertThat(responses.stream().filter((response) -> response.getStatus() != 201)).hasSize(THREADS - 1)
				.allSatisfy((response) -> {
					assertThat(response.getStatus()).isEqualTo(409);
					assertThat(codeOf(response)).isEqualTo("INVALID_EVENT_SEQUENCE");
				});
			// The one from the creation of the site, plus exactly one new.
			assertThat(this.jdbcClient
				.sql("SELECT count(*) FROM bait_site_events WHERE bait_site_id = ?::uuid AND event_type = 'INSTALLED'")
				.param(siteIdOf(events))
				.query(Long.class)
				.single()).isEqualTo(2);
		}
		finally {
			executor.shutdownNow();
		}
	}

	@Test
	void concurrentVoidsOfOneEventAllAnswer200WithOneVoidedAtAndOneLogLine(CapturedOutput output) throws Exception {
		String token = TestTokens.trusted("test-" + UUID.randomUUID());
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		String events = newSiteEvents(token, newSitesPath(token), now.minusHours(2));
		String eventId = UuidV7.generate().toString();
		assertThat(postJson(token, events, eventBody(eventId, "INSPECTED", now.minusHours(1))).getStatus()).isEqualTo(201);

		List<Callable<MockHttpServletResponse>> requests = Collections.nCopies(THREADS, () -> voidEvent(token, events, eventId));
		ExecutorService executor = Executors.newFixedThreadPool(THREADS);
		try {
			List<MockHttpServletResponse> responses = runTogether(executor, requests);

			assertThat(responses).allSatisfy((response) -> assertThat(response.getStatus()).isEqualTo(200));
			Instant stored = storedVoidedAt(eventId);
			assertThat(stored).isNotNull();
			assertThat(responses).allSatisfy((response) -> assertThat(
					Instant.parse(JsonPath.read(response.getContentAsString(StandardCharsets.UTF_8), "$.voidedAt")))
				.isEqualTo(stored));
			assertThat(output.getOut().lines().filter((line) -> line.contains("Bait site event voided: eventId=" + eventId)))
				.hasSize(1);
		}
		finally {
			executor.shutdownNow();
		}
	}

	@Test
	void voidingACaptureAndIdentifyingItAtTheSameTimeNeverBothSucceed() throws Exception {
		String token = TestTokens.trusted("test-" + UUID.randomUUID());
		String sites = newSitesPath(token);
		OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
		ExecutorService executor = Executors.newFixedThreadPool(2);
		try {
			for (int round = 0; round < ROUNDS; round++) {
				String events = newSiteEvents(token, sites, now.minusHours(2));
				String captureId = UuidV7.generate().toString();
				assertThat(postJson(token, events, eventBody(captureId, "CAPTURED", now.minusHours(1))).getStatus())
					.isEqualTo(201);
				String identifiedId = UuidV7.generate().toString();
				String identified = """
						{"id": "%s", "type": "IDENTIFIED", "occurredAt": "%s", "speciesId": "%s", "identifiedEventId": "%s"}
						""".formatted(identifiedId, now.minusMinutes(1), JATAI, captureId);

				List<MockHttpServletResponse> responses = runTogether(executor,
						List.of(() -> voidEvent(token, events, captureId), () -> postJson(token, events, identified)));

				MockHttpServletResponse voidResponse = responses.get(0);
				MockHttpServletResponse identifiedResponse = responses.get(1);
				if (voidResponse.getStatus() == 200) {
					assertThat(identifiedResponse.getStatus()).isEqualTo(409);
					assertThat(codeOf(identifiedResponse)).isEqualTo("INVALID_EVENT_SEQUENCE");
					assertThat(storedVoidedAt(captureId)).isNotNull();
					assertThat(eventIsStored(identifiedId)).isFalse();
				}
				else {
					assertThat(voidResponse.getStatus()).isEqualTo(409);
					assertThat(codeOf(voidResponse)).isEqualTo("INVALID_EVENT_SEQUENCE");
					assertThat(identifiedResponse.getStatus()).isEqualTo(201);
					assertThat(storedVoidedAt(captureId)).isNull();
					assertThat(eventIsStored(identifiedId)).isTrue();
				}
			}
		}
		finally {
			executor.shutdownNow();
		}
	}

	/**
	 * Releases all requests at the same moment, once every thread is waiting. Responses are in the order of the requests.
	 */
	private static List<MockHttpServletResponse> runTogether(ExecutorService executor,
			List<Callable<MockHttpServletResponse>> requests) throws Exception {
		CountDownLatch ready = new CountDownLatch(requests.size());
		CountDownLatch start = new CountDownLatch(1);
		List<Future<MockHttpServletResponse>> results = new ArrayList<>();
		for (Callable<MockHttpServletResponse> request : requests) {
			results.add(executor.submit(() -> {
				ready.countDown();
				start.await();
				return request.call();
			}));
		}
		ready.await();
		start.countDown();

		List<MockHttpServletResponse> responses = new ArrayList<>();
		for (Future<MockHttpServletResponse> result : results) {
			responses.add(result.get(30, TimeUnit.SECONDS));
		}
		return responses;
	}

	private String newSitesPath(String token) throws Exception {
		String projectId = UuidV7.generate().toString();
		String projects = "/api/projects";
		assertThat(postJson(token, projects, "{\"id\": \"%s\", \"name\": \"Project\"}".formatted(projectId)).getStatus())
			.isEqualTo(201);
		return projects + "/" + projectId + "/bait-sites";
	}

	/**
	 * Creates a site with its INSTALLED and returns the path of its events.
	 */
	private String newSiteEvents(String token, String sites, OffsetDateTime installedAt) throws Exception {
		String siteId = UuidV7.generate().toString();
		assertThat(postJson(token, sites, """
				{"id": "%s", "name": "Isca 31", "latitude": -26.9, "longitude": -49.0,
				"installation": {"id": "%s", "occurredAt": "%s"}}
				""".formatted(siteId, UuidV7.generate(), installedAt)).getStatus()).isEqualTo(201);
		return sites + "/" + siteId + "/events";
	}

	// The site id inside the path of its events.
	private static String siteIdOf(String events) {
		String[] segments = events.split("/");
		return segments[segments.length - 2];
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

	private MockHttpServletResponse voidEvent(String token, String events, String eventId) throws Exception {
		return this.mockMvc.perform(post(events + "/" + eventId + "/void").header("Authorization", "Bearer " + token))
			.andReturn()
			.getResponse();
	}

	private static String eventBody(String id, String type, OffsetDateTime occurredAt) {
		return "{\"id\": \"%s\", \"type\": \"%s\", \"occurredAt\": \"%s\"}".formatted(id, type, occurredAt);
	}

	private static String codeOf(MockHttpServletResponse response) throws Exception {
		return JsonPath.read(response.getContentAsString(StandardCharsets.UTF_8), "$.code");
	}

	private Instant storedVoidedAt(String eventId) {
		Map<String, Object> row = this.jdbcClient.sql("SELECT voided_at FROM bait_site_events WHERE id = ?::uuid")
			.param(eventId)
			.query()
			.singleRow();
		Timestamp voidedAt = (Timestamp) row.get("voided_at");
		return (voidedAt != null) ? voidedAt.toInstant() : null;
	}

	private boolean eventIsStored(String eventId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_site_events WHERE id = ?::uuid")
			.param(eventId)
			.query(Long.class)
			.single() > 0;
	}

}
