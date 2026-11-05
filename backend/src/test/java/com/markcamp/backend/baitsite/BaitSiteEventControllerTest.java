package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.jayway.jsonpath.JsonPath;
import com.markcamp.backend.PostgresTestContainer;
import com.markcamp.backend.TestTokens;
import com.markcamp.backend.common.UuidV7;

/**
 * Sends real signed tokens through the whole filter chain and uses a real Postgres.
 * <p>
 * No MockMvc printing: when a test fails it prints the Authorization header and the body, and the captured output covers
 * the whole class, so one failure would also fail the check on what the application logs.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ExtendWith(OutputCaptureExtension.class)
class BaitSiteEventControllerTest implements PostgresTestContainer {

	private static final List<String> PROBLEM_KEYS = List.of("type", "title", "status", "detail", "instance", "code",
			"errors");

	// In eventBody, removes the key instead of setting it.
	private static final String ABSENT = "<absent>";

	private static final OffsetDateTime OCT_1 = OffsetDateTime.parse("2025-10-01T09:00:00-03:00");

	private static final OffsetDateTime OCT_5 = OffsetDateTime.parse("2025-10-05T09:00:00-03:00");

	private static final OffsetDateTime OCT_10 = OffsetDateTime.parse("2025-10-10T09:00:00-03:00");

	@TestBean(methodName = "com.markcamp.backend.TestTokens#jwtDecoder")
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JdbcClient jdbcClient;

	// Record

	@ParameterizedTest
	@MethodSource("typesWithAValidPrefix")
	void eachTypeIsRecordedFromAValidState(String type, List<String> prefix) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		prefix.forEach((prefixType) -> recordOk(subject, projectId, siteId, prefixType, OCT_5));
		String eventId = UuidV7.generate().toString();
		// Fixed microseconds, so a rounded or truncated value cannot pass by chance.
		OffsetDateTime occurredAt = OCT_10.withNano(123_456_000);

		MockHttpServletResponse response = postEvent(subject, projectId, siteId,
				eventBody("id", quoted(eventId), "type", quoted(type), "occurredAt", quoted(occurredAt.toString())));

		assertThat(response.getStatus()).isEqualTo(201);
		assertThat(response.getHeader("Location")).isEqualTo(eventsPath(projectId, siteId) + "/" + eventId);
		String body = bodyOf(response);
		assertThat(JsonPath.<Map<String, Object>>read(body, "$")).containsOnlyKeys("id", "type", "occurredAt", "recordedAt");
		assertThat(JsonPath.<String>read(body, "$.id")).isEqualTo(eventId);
		assertThat(JsonPath.<String>read(body, "$.type")).isEqualTo(type);
		assertThat(Instant.parse(JsonPath.<String>read(body, "$.occurredAt"))).isEqualTo(occurredAt.toInstant());
		assertThat(JsonPath.<String>read(body, "$.recordedAt")).isNotBlank();

		Map<String, Object> event = this.jdbcClient.sql("SELECT * FROM bait_site_events WHERE id = ?::uuid")
			.param(eventId)
			.query()
			.singleRow();
		assertThat(event.get("bait_site_id")).isEqualTo(UUID.fromString(siteId));
		assertThat(event.get("event_type")).isEqualTo(type);
		assertThat(event.get("recorded_by")).isEqualTo(userId(subject));
		assertThat(((Timestamp) event.get("occurred_at")).toInstant()).isEqualTo(occurredAt.toInstant());
		assertThat(event.get("species_id")).isNull();
		assertThat(event.get("identified_event_id")).isNull();
		assertThat(event.get("voided_at")).isNull();
	}

	static Stream<Arguments> typesWithAValidPrefix() {
		return Stream.of(arguments("INSTALLED", List.of("REMOVED")), arguments("ACTIVITY", List.of()),
				arguments("CAPTURED", List.of()), arguments("LOST", List.of("CAPTURED")),
				arguments("COLLECTED", List.of("CAPTURED")), arguments("REMOVED", List.of()),
				arguments("INSPECTED", List.of()));
	}

	// Invalid sequences

	@Test
	void invalidTransitionIsConflictAndStoresNothing() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		String eventId = UuidV7.generate().toString();

		assertProblem(postEvent(subject, projectId, siteId, eventBody("id", quoted(eventId), "type", quoted("COLLECTED"))),
				409, "INVALID_EVENT_SEQUENCE");

		assertThat(eventExists(eventId)).isFalse();
		assertProblem(getEvent(subject, projectId, siteId, eventId), 404, "BAIT_SITE_EVENT_NOT_FOUND");
	}

	@Test
	void eventValidAtItsPositionThatBreaksALaterEventIsConflict() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		recordOk(subject, projectId, siteId, "CAPTURED", OCT_10);
		String eventId = UuidV7.generate().toString();

		assertProblem(postEvent(subject, projectId, siteId, eventBody("id", quoted(eventId), "type", quoted("REMOVED"),
				"occurredAt", quoted(OCT_5.toString()))), 409, "INVALID_EVENT_SEQUENCE");

		assertThat(eventExists(eventId)).isFalse();
		assertThat(status(subject, projectId, siteId)).isEqualTo("CAPTURED");
	}

	@ParameterizedTest
	@EnumSource(value = BaitSiteEventType.class, mode = EnumSource.Mode.EXCLUDE, names = "IDENTIFIED")
	void anyEventBeforeTheFirstInstalledIsConflict(BaitSiteEventType type) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		String eventId = UuidV7.generate().toString();

		assertProblem(postEvent(subject, projectId, siteId, eventBody("id", quoted(eventId), "type", quoted(type.name()),
				"occurredAt", quoted(OCT_1.minusDays(1).toString()))), 409, "INVALID_EVENT_SEQUENCE");

		assertThat(eventExists(eventId)).isFalse();
	}

	@Test
	void outOfOrderButValidEventIsRecordedAndDoesNotChangeTheStatus() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		recordOk(subject, projectId, siteId, "CAPTURED", OCT_10);

		assertThat(postEvent(subject, projectId, siteId,
				eventBody("type", quoted("ACTIVITY"), "occurredAt", quoted(OCT_5.toString()))).getStatus()).isEqualTo(201);

		assertThat(status(subject, projectId, siteId)).isEqualTo("CAPTURED");
	}

	@Test
	void inspectedLeavesTheStatusUnchanged() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		recordOk(subject, projectId, siteId, "CAPTURED", OCT_5);

		recordOk(subject, projectId, siteId, "INSPECTED", OCT_10);

		assertThat(status(subject, projectId, siteId)).isEqualTo("CAPTURED");
	}

	// The ids differ in the first bit, the case where UUID.compareTo (signed) and Postgres (unsigned) disagree: Postgres
	// puts the low id first, Java would put the high id first.
	@Test
	void sameOccurredAtIsDecidedByIdInTheReplayAndInTheStatus() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		String low = idWithHighBits("00000000");
		String high = idWithHighBits("f0000000");

		// Inserted in the order that does not match the ids, so the insertion order cannot decide.
		assertThat(postEvent(subject, projectId, siteId, eventBody("id", quoted(low), "type", quoted("CAPTURED"),
				"occurredAt", quoted(OCT_5.toString()))).getStatus()).isEqualTo(201);
		assertThat(postEvent(subject, projectId, siteId, eventBody("id", quoted(high), "type", quoted("LOST"),
				"occurredAt", quoted(OCT_5.toString()))).getStatus()).isEqualTo(201);

		assertThat(status(subject, projectId, siteId)).isEqualTo("LOST");
		assertThat(listedTypes(subject, projectId, siteId)).containsExactly("INSTALLED", "CAPTURED", "LOST");
	}

	@Test
	void sameOccurredAtWithTheLowerIdIsReplayedFirstAndCanBeInvalid() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		String high = idWithHighBits("f0000000");
		String low = idWithHighBits("00000000");
		assertThat(postEvent(subject, projectId, siteId, eventBody("id", quoted(high), "type", quoted("CAPTURED"),
				"occurredAt", quoted(OCT_5.toString()))).getStatus()).isEqualTo(201);

		// Replayed before the CAPTURED, because of its id.
		assertProblem(postEvent(subject, projectId, siteId, eventBody("id", quoted(low), "type", quoted("COLLECTED"),
				"occurredAt", quoted(OCT_5.toString()))), 409, "INVALID_EVENT_SEQUENCE");

		assertThat(eventExists(low)).isFalse();
	}

	// Resend

	@Test
	void resendOfAStoredEventIsIdAlreadyExistsAndGetConfirmsIt() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		recordOk(subject, projectId, siteId, "CAPTURED", OCT_5);
		String eventId = UuidV7.generate().toString();
		// COLLECTED twice would be an invalid sequence: this is the case where the order of the checks decides.
		String body = eventBody("id", quoted(eventId), "type", quoted("COLLECTED"), "occurredAt", quoted(OCT_10.toString()));

		MockHttpServletResponse first = postEvent(subject, projectId, siteId, body);
		assertThat(first.getStatus()).isEqualTo(201);

		assertProblem(postEvent(subject, projectId, siteId, body), 409, "ID_ALREADY_EXISTS");

		MockHttpServletResponse confirmed = getEvent(subject, projectId, siteId, eventId);
		assertThat(confirmed.getStatus()).isEqualTo(200);
		assertThat(JsonPath.<Map<String, Object>>read(bodyOf(confirmed), "$"))
			.isEqualTo(JsonPath.<Map<String, Object>>read(bodyOf(first), "$"));
		assertThat(eventCount(siteId)).isEqualTo(3);
	}

	@Test
	void idOfAnEventOnAnotherSiteOrProjectIsIdAlreadyExists() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		String otherSiteId = newSite(subject, projectId);
		String otherOwner = newSubject();
		String otherProject = newProject(otherOwner);
		String otherProjectSite = newSite(otherOwner, otherProject);
		String sameProjectEvent = recordOk(subject, projectId, otherSiteId, "ACTIVITY", OCT_5);
		String otherProjectEvent = recordOk(otherOwner, otherProject, otherProjectSite, "ACTIVITY", OCT_5);

		for (String takenId : List.of(sameProjectEvent, otherProjectEvent)) {
			assertProblem(postEvent(subject, projectId, siteId,
					eventBody("id", quoted(takenId), "type", quoted("CAPTURED"), "occurredAt", quoted(OCT_10.toString()))),
					409, "ID_ALREADY_EXISTS");
		}

		assertThat(eventCount(siteId)).isEqualTo(1);
		assertThat(storedType(sameProjectEvent)).isEqualTo("ACTIVITY");
		assertThat(storedType(otherProjectEvent)).isEqualTo("ACTIVITY");
	}

	// Access

	// The caller is a member of both projects, so only the project filter in the queries can stop this.
	@Test
	void siteOfAnotherProjectIsNotFoundEverywhereAndNothingIsWritten() throws Exception {
		String subject = newSubject();
		String projectWithSite = newProject(subject);
		String otherProject = newProject(subject);
		String siteId = newSite(subject, projectWithSite);
		String eventId = recordOk(subject, projectWithSite, siteId, "ACTIVITY", OCT_5);
		long eventsBefore = eventCount(siteId);
		String newEventId = UuidV7.generate().toString();

		Map<String, Object> postInOther = assertProblem(
				postEvent(subject, otherProject, siteId, eventBody("id", quoted(newEventId))), 404, "BAIT_SITE_NOT_FOUND");
		Map<String, Object> postMissing = assertProblem(
				postEvent(subject, otherProject, UuidV7.generate().toString(), eventBody()), 404, "BAIT_SITE_NOT_FOUND");
		assertThat(withoutInstance(postInOther)).isEqualTo(withoutInstance(postMissing));

		Map<String, Object> listInOther = assertProblem(perform(get(eventsPath(otherProject, siteId)), subject), 404,
				"BAIT_SITE_NOT_FOUND");
		assertThat(withoutInstance(listInOther)).isEqualTo(withoutInstance(postMissing));

		assertProblem(getEvent(subject, otherProject, siteId, eventId), 404, "BAIT_SITE_EVENT_NOT_FOUND");

		assertThat(eventExists(newEventId)).isFalse();
		assertThat(eventCount(siteId)).isEqualTo(eventsBefore);
	}

	@Test
	void everyWayOfNotFindingAnEventGivesTheSameBody() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String otherProject = newProject(subject);
		String siteId = newSite(subject, projectId);
		String otherSiteId = newSite(subject, projectId);
		String eventId = recordOk(subject, projectId, siteId, "ACTIVITY", OCT_5);

		Map<String, Object> missingEvent = assertProblem(
				getEvent(subject, projectId, siteId, UuidV7.generate().toString()), 404, "BAIT_SITE_EVENT_NOT_FOUND");
		Map<String, Object> eventOfOtherSite = assertProblem(getEvent(subject, projectId, otherSiteId, eventId), 404,
				"BAIT_SITE_EVENT_NOT_FOUND");
		Map<String, Object> siteOfOtherProject = assertProblem(getEvent(subject, otherProject, siteId, eventId), 404,
				"BAIT_SITE_EVENT_NOT_FOUND");
		Map<String, Object> missingSite = assertProblem(
				getEvent(subject, projectId, UuidV7.generate().toString(), eventId), 404, "BAIT_SITE_EVENT_NOT_FOUND");

		assertThat(withoutInstance(eventOfOtherSite)).isEqualTo(withoutInstance(missingEvent));
		assertThat(withoutInstance(siteOfOtherProject)).isEqualTo(withoutInstance(missingEvent));
		assertThat(withoutInstance(missingSite)).isEqualTo(withoutInstance(missingEvent));
	}

	@Test
	void nonMemberGetsTheSame404AsMissingProjectOnEveryEndpointAndWritesNothing() throws Exception {
		String owner = newSubject();
		String projectId = newProject(owner);
		String siteId = newSite(owner, projectId);
		String eventId = recordOk(owner, projectId, siteId, "ACTIVITY", OCT_5);
		long eventsBefore = eventCount(siteId);
		String stranger = newSubject();
		String missingProject = UuidV7.generate().toString();
		String newEventId = UuidV7.generate().toString();

		List<String> bodies = List.of(eventBody("id", quoted(newEventId), "type", quoted("CAPTURED")),
				// Never a conflict or a validation error: either would say the request got past the access check.
				eventBody("id", quoted(eventId)), eventBody("id", quoted("not-a-uuid"), "type", ABSENT));
		for (String body : bodies) {
			assertSame404(postEvent(stranger, projectId, siteId, body), postEvent(stranger, missingProject, siteId, body));
		}
		assertSame404(perform(get(eventsPath(projectId, siteId)), stranger),
				perform(get(eventsPath(missingProject, siteId)), stranger));
		assertSame404(getEvent(stranger, projectId, siteId, eventId), getEvent(stranger, missingProject, siteId, eventId));

		assertThat(eventExists(newEventId)).isFalse();
		assertThat(eventCount(siteId)).isEqualTo(eventsBefore);
	}

	// Validation

	@ParameterizedTest
	@MethodSource("invalidValues")
	void invalidFieldIsReportedAndNothingIsStored(String key, String rawValue, String code) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);

		assertInvalid(postEvent(subject, projectId, siteId, eventBody(key, rawValue)), Map.of(key, code));

		assertThat(eventCount(siteId)).isEqualTo(1);
	}

	static Stream<Arguments> invalidValues() {
		return Stream.of(arguments("id", ABSENT, "REQUIRED"), arguments("id", "null", "REQUIRED"),
				arguments("id", quoted(""), "REQUIRED"), arguments("id", quoted("   "), "REQUIRED"),
				arguments("id", quoted(" "), "REQUIRED"), arguments("id", quoted("\\u00A0"), "REQUIRED"),
				arguments("id", quoted("not-a-uuid"), "INVALID_FORMAT"),
				arguments("id", quoted(UUID.randomUUID().toString()), "INVALID_FORMAT"),
				// Machine data is not trimmed: a padded value is a client bug we want to see.
				arguments("id", quoted(" " + UuidV7.generate() + " "), "INVALID_FORMAT"),

				arguments("type", ABSENT, "REQUIRED"), arguments("type", "null", "REQUIRED"),
				arguments("type", quoted(""), "REQUIRED"), arguments("type", quoted("   "), "REQUIRED"),
				arguments("type", quoted(" "), "REQUIRED"), arguments("type", quoted("\\u00A0"), "REQUIRED"),
				arguments("type", quoted(" CAPTURED "), "INVALID_FORMAT"),
				arguments("type", quoted("captured"), "INVALID_FORMAT"),
				arguments("type", quoted("UNKNOWN"), "INVALID_FORMAT"),
				arguments("type", quoted("IDENTIFIED"), "INVALID_FORMAT"),

				arguments("occurredAt", ABSENT, "REQUIRED"), arguments("occurredAt", "null", "REQUIRED"),
				arguments("occurredAt", quoted(""), "REQUIRED"), arguments("occurredAt", quoted("   "), "REQUIRED"),
				arguments("occurredAt", quoted(" "), "REQUIRED"), arguments("occurredAt", quoted("\\u00A0"), "REQUIRED"),
				arguments("occurredAt", quoted(" 2026-11-03T09:20:00Z "), "INVALID_FORMAT"),
				arguments("occurredAt", quoted("2026-11-03T09:20:00"), "INVALID_FORMAT"),
				arguments("occurredAt", quoted("garbage"), "INVALID_FORMAT"),
				arguments("occurredAt", quoted("1999-12-31T23:59:59Z"), "OUT_OF_RANGE"),
				arguments("occurredAt", quoted(OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(11).toString()),
						"OUT_OF_RANGE"));
	}

	@Test
	void allInvalidFieldsAreReportedInOneResponse() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);

		assertInvalid(
				postEvent(subject, projectId, newSite(subject, projectId),
						eventBody("id", quoted("not-a-uuid"), "type", ABSENT, "occurredAt", quoted("garbage"))),
				Map.of("id", "INVALID_FORMAT", "type", "REQUIRED", "occurredAt", "INVALID_FORMAT"));
	}

	@Test
	void validationRunsBeforeTheSiteIsLookedUp() throws Exception {
		String subject = newSubject();

		assertInvalid(postEvent(subject, newProject(subject), UuidV7.generate().toString(), eventBody("type", ABSENT)),
				Map.of("type", "REQUIRED"));
	}

	@ParameterizedTest
	@MethodSource("malformedValues")
	void wrongJsonTypeIsMalformedRequest(String key, String rawValue) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);

		assertProblem(postEvent(subject, projectId, siteId, eventBody(key, rawValue)), 400, "MALFORMED_REQUEST");

		assertThat(eventCount(siteId)).isEqualTo(1);
	}

	static Stream<Arguments> malformedValues() {
		return Stream.of(arguments("type", "5"), arguments("type", "true"), arguments("id", "5"),
				arguments("occurredAt", "1730000000"));
	}

	// Status

	@Test
	void statusFollowsEveryKindOfEventInCreateListAndGet() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();

		MockHttpServletResponse created = createSite(subject, projectId, siteId, OCT_1);
		assertThat(JsonPath.<String>read(bodyOf(created), "$.status")).isEqualTo("ARMED");
		assertStatusInListAndGet(subject, projectId, siteId, "ARMED");

		List<List<String>> steps = List.of(List.of("ACTIVITY", "ACTIVE"), List.of("CAPTURED", "CAPTURED"),
				List.of("INSPECTED", "CAPTURED"), List.of("LOST", "LOST"), List.of("INSTALLED", "ARMED"),
				List.of("REMOVED", "EMPTY"), List.of("INSTALLED", "ARMED"), List.of("CAPTURED", "CAPTURED"),
				List.of("COLLECTED", "EMPTY"));
		OffsetDateTime occurredAt = OCT_5;
		for (List<String> step : steps) {
			occurredAt = occurredAt.plusDays(1);
			recordOk(subject, projectId, siteId, step.get(0), occurredAt);

			assertStatusInListAndGet(subject, projectId, siteId, step.get(1));
		}
	}

	// Keeps the two paths from drifting apart: replay on write, SQL on read. Written directly to the database so that
	// only the read path runs.
	@ParameterizedTest
	@MethodSource("validCases")
	void statusQueryAgreesWithTheReplay(BaitSiteStateMachineTest.Case testCase) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		UUID userId = userId(subject);
		String siteId = UuidV7.generate().toString();
		this.jdbcClient
			.sql("""
					INSERT INTO bait_sites (id, project_id, name, latitude, longitude, created_by)
					VALUES (?::uuid, ?::uuid, 'Isca', 0, 0, ?)
					""")
			.params(siteId, projectId, userId)
			.update();
		OffsetDateTime occurredAt = OCT_1;
		for (BaitSiteEventType event : testCase.events()) {
			occurredAt = occurredAt.plusHours(1);
			this.jdbcClient
				.sql("""
						INSERT INTO bait_site_events (id, bait_site_id, event_type, occurred_at, recorded_by)
						VALUES (?, ?::uuid, ?, ?, ?)
						""")
				.params(UuidV7.generate(), siteId, event.name(), occurredAt, userId)
				.update();
		}

		assertStatusInListAndGet(subject, projectId, siteId, testCase.status().name());
	}

	static Stream<BaitSiteStateMachineTest.Case> validCases() {
		return BaitSiteStateMachineTest.cases().stream().filter(BaitSiteStateMachineTest.Case::valid);
	}

	// List

	@Test
	void listReturnsOnlyEventsOfThisSiteInHistoryOrderNotInsertionOrder() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();
		String installed = UuidV7.generate().toString();
		createSite(subject, projectId, siteBody(siteId, installed, OCT_1));
		String otherSite = newSite(subject, projectId);
		recordOk(subject, projectId, otherSite, "CAPTURED", OCT_5);
		String captured = recordOk(subject, projectId, siteId, "CAPTURED", OCT_10);
		String activity = recordOk(subject, projectId, siteId, "ACTIVITY", OCT_5);

		MockHttpServletResponse response = perform(get(eventsPath(projectId, siteId)), subject);

		assertThat(response.getStatus()).isEqualTo(200);
		String body = bodyOf(response);
		assertThat(JsonPath.<Map<String, Object>>read(body, "$")).containsOnlyKeys("items");
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].id")).containsExactly(installed, activity, captured);
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].type")).containsExactly("INSTALLED", "ACTIVITY", "CAPTURED");
		assertThat(JsonPath.<Map<String, Object>>read(body, "$.items[0]")).containsOnlyKeys("id", "type", "occurredAt",
				"recordedAt");
	}

	// Nothing can be voided through the API yet, so this writes voided_at directly.
	@Test
	void voidedEventsAreIgnoredByTheListTheStatusAndTheReplay() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = newSite(subject, projectId);
		String captured = recordOk(subject, projectId, siteId, "CAPTURED", OCT_5);
		this.jdbcClient.sql("UPDATE bait_site_events SET voided_at = now(), voided_by = ? WHERE id = ?::uuid")
			.params(userId(subject), captured)
			.update();

		assertThat(listedTypes(subject, projectId, siteId)).containsExactly("INSTALLED");
		assertThat(status(subject, projectId, siteId)).isEqualTo("ARMED");
		assertProblem(postEvent(subject, projectId, siteId,
				eventBody("type", quoted("COLLECTED"), "occurredAt", quoted(OCT_10.toString()))), 409,
				"INVALID_EVENT_SEQUENCE");
	}

	// Logging

	@Test
	void recordingLogsIdsAndTypeAndNeverNameOrCoordinates(CapturedOutput output) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();
		createSite(subject, projectId, """
				{"id": "%s", "name": "Isca do Quintal", "latitude": -26.91937, "longitude": -49.06613,
				"installation": {"id": "%s", "occurredAt": "%s"}}
				""".formatted(siteId, UuidV7.generate(), OCT_1));
		String eventId = UuidV7.generate().toString();

		assertThat(postEvent(subject, projectId, siteId, eventBody("id", quoted(eventId), "type", quoted("CAPTURED")))
			.getStatus()).isEqualTo(201);

		String line = "Bait site event recorded: eventId=" + eventId + " baitSiteId=" + siteId + " projectId=" + projectId
				+ " userId=" + userId(subject) + " type=CAPTURED";
		assertThat(output.getOut().lines().filter((logLine) -> logLine.contains(line))).singleElement()
			.satisfies((logLine) -> assertThat(logLine).contains("INFO"));
		assertThat(output.getAll()).doesNotContain("Isca do Quintal", "26.91937", "49.06613", "eyJ");
	}

	private void assertStatusInListAndGet(String subject, String projectId, String siteId, String expected)
			throws Exception {
		assertThat(status(subject, projectId, siteId)).isEqualTo(expected);
		String list = bodyOf(perform(get(sitesPath(projectId)), subject));
		assertThat(JsonPath.<List<String>>read(list, "$.items[?(@.id == '" + siteId + "')].status"))
			.containsExactly(expected);
	}

	private void assertSame404(MockHttpServletResponse nonMember, MockHttpServletResponse missingProject)
			throws Exception {
		assertThat(withoutInstance(assertProblem(nonMember, 404, "PROJECT_NOT_FOUND")))
			.isEqualTo(withoutInstance(assertProblem(missingProject, 404, "PROJECT_NOT_FOUND")));
	}

	private void assertInvalid(MockHttpServletResponse response, Map<String, String> expected) throws Exception {
		Map<String, Object> problem = assertProblem(response, 400, "VALIDATION_FAILED");
		@SuppressWarnings("unchecked")
		List<Map<String, String>> errors = (List<Map<String, String>>) problem.get("errors");
		Map<String, String> codesByField = new HashMap<>();
		errors.forEach((error) -> codesByField.put(error.get("field"), error.get("code")));
		assertThat(errors).hasSameSizeAs(expected.keySet());
		assertThat(codesByField).isEqualTo(expected);
	}

	/**
	 * Asserts what every error response must have (ADR 0006) and returns its body.
	 */
	private Map<String, Object> assertProblem(MockHttpServletResponse response, int status, String code)
			throws Exception {
		assertThat(response.getStatus()).isEqualTo(status);
		assertThat(response.getContentType()).isEqualTo(MediaType.APPLICATION_PROBLEM_JSON_VALUE);
		Map<String, Object> problem = JsonPath.read(bodyOf(response), "$");
		assertThat(PROBLEM_KEYS).containsAll(problem.keySet());
		assertThat(problem.get("type")).isEqualTo("about:blank");
		assertThat(problem.get("title")).asString().isNotBlank();
		assertThat(problem.get("status")).isEqualTo(status);
		assertThat(problem.get("detail")).asString().isNotBlank();
		assertThat(problem.get("instance")).asString().startsWith("/api/");
		assertThat(problem.get("code")).isEqualTo(code);
		assertThat(problem.containsKey("errors")).isEqualTo("VALIDATION_FAILED".equals(code));
		return problem;
	}

	private static Map<String, Object> withoutInstance(Map<String, Object> problem) {
		Map<String, Object> copy = new HashMap<>(problem);
		copy.remove("instance");
		return copy;
	}

	private String newProject(String subject) throws Exception {
		String id = UuidV7.generate().toString();
		String body = "{\"id\": \"%s\", \"name\": \"Project\"}".formatted(id);
		MockHttpServletResponse response = perform(
				post("/api/projects").contentType(MediaType.APPLICATION_JSON).content(body), subject);
		assertThat(response.getStatus()).isEqualTo(201);
		return id;
	}

	/**
	 * A site with its INSTALLED on 1 Oct, so tests can add earlier and later events.
	 */
	private String newSite(String subject, String projectId) throws Exception {
		String siteId = UuidV7.generate().toString();
		assertThat(createSite(subject, projectId, siteId, OCT_1).getStatus()).isEqualTo(201);
		return siteId;
	}

	private MockHttpServletResponse createSite(String subject, String projectId, String siteId, OffsetDateTime installedAt)
			throws Exception {
		return createSite(subject, projectId, siteBody(siteId, UuidV7.generate().toString(), installedAt));
	}

	private MockHttpServletResponse createSite(String subject, String projectId, String body) throws Exception {
		return perform(post(sitesPath(projectId)).contentType(MediaType.APPLICATION_JSON).content(body), subject);
	}

	private static String siteBody(String siteId, String installationId, OffsetDateTime installedAt) {
		return """
				{"id": "%s", "name": "Isca 31", "latitude": -26.9194, "longitude": -49.0661,
				"installation": {"id": "%s", "occurredAt": "%s"}}
				""".formatted(siteId, installationId, installedAt);
	}

	/**
	 * Records an event that must be accepted and returns its id.
	 */
	private String recordOk(String subject, String projectId, String siteId, String type, OffsetDateTime occurredAt) {
		try {
			String id = UuidV7.generate().toString();
			assertThat(postEvent(subject, projectId, siteId,
					eventBody("id", quoted(id), "type", quoted(type), "occurredAt", quoted(occurredAt.toString())))
				.getStatus()).isEqualTo(201);
			return id;
		}
		catch (Exception ex) {
			throw new IllegalStateException(ex);
		}
	}

	private MockHttpServletResponse postEvent(String subject, String projectId, String siteId, String body)
			throws Exception {
		return perform(post(eventsPath(projectId, siteId)).contentType(MediaType.APPLICATION_JSON).content(body), subject);
	}

	private MockHttpServletResponse getEvent(String subject, String projectId, String siteId, String eventId)
			throws Exception {
		return perform(get(eventsPath(projectId, siteId) + "/" + eventId), subject);
	}

	private String status(String subject, String projectId, String siteId) throws Exception {
		return JsonPath.read(bodyOf(perform(get(sitesPath(projectId) + "/" + siteId), subject)), "$.status");
	}

	private List<String> listedTypes(String subject, String projectId, String siteId) throws Exception {
		return JsonPath.read(bodyOf(perform(get(eventsPath(projectId, siteId)), subject)), "$.items[*].type");
	}

	private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String subject) throws Exception {
		return this.mockMvc.perform(request.header("Authorization", "Bearer " + TestTokens.trusted(subject)))
			.andReturn()
			.getResponse();
	}

	private static String sitesPath(String projectId) {
		return "/api/projects/" + projectId + "/bait-sites";
	}

	private static String eventsPath(String projectId, String siteId) {
		return sitesPath(projectId) + "/" + siteId + "/events";
	}

	/**
	 * A valid ACTIVITY on 10 Oct, with some fields replaced by raw JSON, or removed with {@link #ABSENT}.
	 */
	private static String eventBody(String... keysAndRawValues) {
		Map<String, String> event = new LinkedHashMap<>();
		event.put("id", quoted(UuidV7.generate().toString()));
		event.put("type", quoted("ACTIVITY"));
		event.put("occurredAt", quoted(OCT_10.toString()));
		for (int i = 0; i < keysAndRawValues.length; i += 2) {
			if (ABSENT.equals(keysAndRawValues[i + 1])) {
				event.remove(keysAndRawValues[i]);
			}
			else {
				event.put(keysAndRawValues[i], keysAndRawValues[i + 1]);
			}
		}
		return event.entrySet()
			.stream()
			.map((field) -> quoted(field.getKey()) + ": " + field.getValue())
			.collect(Collectors.joining(", ", "{", "}"));
	}

	/**
	 * A valid UUID v7 with the given first 8 hex digits and a random end, so tests control how ids sort.
	 */
	private static String idWithHighBits(String first8HexDigits) {
		long end = ThreadLocalRandom.current().nextLong(1L << 48);
		return "%s-0000-7000-8000-%012x".formatted(first8HexDigits, end);
	}

	private static String quoted(String value) {
		return "\"" + value + "\"";
	}

	private static String bodyOf(MockHttpServletResponse response) throws Exception {
		return response.getContentAsString(StandardCharsets.UTF_8);
	}

	private static String newSubject() {
		return "test-" + UUID.randomUUID();
	}

	private UUID userId(String subject) {
		return this.jdbcClient.sql("SELECT id FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject = ?")
			.param(subject)
			.query(UUID.class)
			.single();
	}

	private boolean eventExists(String eventId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_site_events WHERE id = ?::uuid")
			.param(eventId)
			.query(Long.class)
			.single() > 0;
	}

	private long eventCount(String siteId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_site_events WHERE bait_site_id = ?::uuid")
			.param(siteId)
			.query(Long.class)
			.single();
	}

	private String storedType(String eventId) {
		return this.jdbcClient.sql("SELECT event_type FROM bait_site_events WHERE id = ?::uuid")
			.param(eventId)
			.query(String.class)
			.single();
	}

}
