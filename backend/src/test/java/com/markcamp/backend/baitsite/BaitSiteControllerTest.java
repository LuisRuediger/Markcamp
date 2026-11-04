package com.markcamp.backend.baitsite;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.sql.Timestamp;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
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
 * There is no way to add members to a project yet, so every caller here is an OWNER or a non-member. A MEMBER has no
 * test until that endpoint exists.
 * <p>
 * No MockMvc printing: when a test fails it prints the Authorization header and the body, and the captured output
 * covers the whole class, so one failure would also fail the check on what the application logs.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ExtendWith(OutputCaptureExtension.class)
class BaitSiteControllerTest implements PostgresTestContainer {

	private static final List<String> PROBLEM_KEYS = List.of("type", "title", "status", "detail", "instance", "code",
			"errors");

	// In siteBody, removes the key instead of setting it.
	private static final String ABSENT = "<absent>";

	@TestBean(methodName = "com.markcamp.backend.TestTokens#jwtDecoder")
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JdbcClient jdbcClient;

	// Create

	@Test
	void createReturnsSiteAndStoresSiteWithInstalledEvent() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();
		String eventId = UuidV7.generate().toString();
		// Fixed microseconds, so a rounded or truncated value cannot pass by chance.
		OffsetDateTime occurredAt = OffsetDateTime.now(ZoneOffset.ofHours(-3)).minusHours(1).withNano(123_456_000);

		MockHttpServletResponse response = createSite(subject, projectId,
				siteBody("id", quoted(siteId), "name", quoted("  Isca 31  "), "latitude", "-26.9194", "longitude",
						"-49.0661", "locationAccuracyM", "12.5", "installation.id", quoted(eventId),
						"installation.occurredAt", quoted(occurredAt.toString())));

		assertThat(response.getStatus()).isEqualTo(201);
		assertThat(response.getHeader("Location")).isEqualTo("/api/projects/" + projectId + "/bait-sites/" + siteId);
		String body = bodyOf(response);
		assertThat(JsonPath.<Map<String, Object>>read(body, "$")).containsOnlyKeys("id", "name", "latitude", "longitude",
				"locationAccuracyM", "createdAt");
		assertThat(JsonPath.<String>read(body, "$.id")).isEqualTo(siteId);
		assertThat(JsonPath.<String>read(body, "$.name")).isEqualTo("Isca 31");
		assertThat(JsonPath.<Double>read(body, "$.latitude")).isEqualTo(-26.9194);
		assertThat(JsonPath.<Double>read(body, "$.longitude")).isEqualTo(-49.0661);
		assertThat(JsonPath.<Double>read(body, "$.locationAccuracyM")).isEqualTo(12.5);
		assertThat(JsonPath.<String>read(body, "$.createdAt")).isNotBlank();

		UUID userId = userId(subject);
		Map<String, Object> site = this.jdbcClient.sql("SELECT * FROM bait_sites WHERE id = ?::uuid")
			.param(siteId)
			.query()
			.singleRow();
		assertThat(site.get("project_id")).isEqualTo(UUID.fromString(projectId));
		assertThat(site.get("created_by")).isEqualTo(userId);
		assertThat(site.get("name")).isEqualTo("Isca 31");

		Map<String, Object> event = this.jdbcClient.sql("SELECT * FROM bait_site_events WHERE bait_site_id = ?::uuid")
			.param(siteId)
			.query()
			.singleRow();
		assertThat(event.get("id")).isEqualTo(UUID.fromString(eventId));
		assertThat(event.get("event_type")).isEqualTo("INSTALLED");
		assertThat(event.get("recorded_by")).isEqualTo(userId);
		assertThat(((Timestamp) event.get("occurred_at")).toInstant()).isEqualTo(occurredAt.toInstant());
		assertThat(event.get("species_id")).isNull();
		assertThat(event.get("identified_event_id")).isNull();
		assertThat(event.get("voided_at")).isNull();
	}

	@Test
	void createWithExistingSiteIdIsConflictAndChangesNothing() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();
		createSite(subject, projectId, siteBody("id", quoted(siteId), "name", quoted("Original")));
		String newEventId = UuidV7.generate().toString();

		MockHttpServletResponse response = createSite(subject, projectId,
				siteBody("id", quoted(siteId), "name", quoted("Different"), "installation.id", quoted(newEventId)));

		assertProblem(response, 409, "ID_ALREADY_EXISTS");
		assertThat(storedName(siteId)).isEqualTo("Original");
		assertThat(eventCount(siteId)).isEqualTo(1);
		assertThat(eventExists(newEventId)).isFalse();
	}

	@Test
	void createWithExistingEventIdIsConflictAndRollsBackTheSite() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String firstSiteId = UuidV7.generate().toString();
		String eventId = UuidV7.generate().toString();
		createSite(subject, projectId, siteBody("id", quoted(firstSiteId), "installation.id", quoted(eventId)));
		String secondSiteId = UuidV7.generate().toString();

		MockHttpServletResponse response = createSite(subject, projectId,
				siteBody("id", quoted(secondSiteId), "installation.id", quoted(eventId)));

		assertProblem(response, 409, "ID_ALREADY_EXISTS");
		assertThat(siteExists(secondSiteId)).isFalse();
		assertThat(eventCount(firstSiteId)).isEqualTo(1);
		assertThat(eventCount(secondSiteId)).isZero();
	}

	@Test
	void createWithSiteIdFromAnotherProjectIsConflictAndGrantsNoAccess() throws Exception {
		String otherOwner = newSubject();
		String otherProject = newProject(otherOwner);
		String siteId = UuidV7.generate().toString();
		createSite(otherOwner, otherProject, siteBody("id", quoted(siteId), "name", quoted("Original")));
		String subject = newSubject();
		String projectId = newProject(subject);

		assertProblem(createSite(subject, projectId, siteBody("id", quoted(siteId), "name", quoted("Mine now"))), 409,
				"ID_ALREADY_EXISTS");

		assertProblem(getSite(subject, projectId, siteId), 404, "BAIT_SITE_NOT_FOUND");
		assertThat(storedName(siteId)).isEqualTo("Original");
	}

	@ParameterizedTest
	@ValueSource(strings = { ABSENT, "null" })
	void createWithoutAccuracyStoresAndReturnsNull(String accuracy) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();

		MockHttpServletResponse response = createSite(subject, projectId,
				siteBody("id", quoted(siteId), "locationAccuracyM", accuracy));

		assertThat(response.getStatus()).isEqualTo(201);
		assertAccuracyIsNullButKeyIsPresent(bodyOf(response));
		assertAccuracyIsNullButKeyIsPresent(bodyOf(getSite(subject, projectId, siteId)));
		assertThat(this.jdbcClient.sql("SELECT location_accuracy_m FROM bait_sites WHERE id = ?::uuid")
			.param(siteId)
			.query()
			.singleRow()
			.get("location_accuracy_m")).isNull();
	}

	@ParameterizedTest
	@MethodSource("acceptedValues")
	void acceptedValuesCreateTheSite(String key, String rawValue) throws Exception {
		String subject = newSubject();

		assertThat(createSite(subject, newProject(subject), siteBody(key, rawValue)).getStatus()).isEqualTo(201);
	}

	static Stream<Arguments> acceptedValues() {
		return Stream.of(arguments("latitude", "90"), arguments("latitude", "-90"), arguments("latitude", "0"),
				arguments("longitude", "180"), arguments("longitude", "-180"), arguments("longitude", "0"),
				arguments("locationAccuracyM", "0.1"), arguments("name", quoted("a".repeat(60))),
				arguments("name", quoted("🐝".repeat(60))), arguments("installation.occurredAt", quoted(
						OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(5).toString())));
	}

	// Validation

	@ParameterizedTest
	@MethodSource("invalidValues")
	void invalidFieldIsReportedAndNothingIsCreated(String key, String rawValue, String field, String code)
			throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);

		assertInvalid(createSite(subject, projectId, siteBody(key, rawValue)), Map.of(field, code));

		assertThat(siteCount(projectId)).isZero();
	}

	static Stream<Arguments> invalidValues() {
		String v4 = quoted(UUID.randomUUID().toString());
		return Stream.of(arguments("id", ABSENT, "id", "REQUIRED"), arguments("id", "null", "id", "REQUIRED"),
				arguments("id", quoted("not-a-uuid"), "id", "INVALID_FORMAT"), arguments("id", v4, "id", "INVALID_FORMAT"),

				arguments("name", ABSENT, "name", "REQUIRED"), arguments("name", "null", "name", "REQUIRED"),
				arguments("name", quoted("   "), "name", "REQUIRED"),
				arguments("name", quoted("\\u00A0\\u00A0"), "name", "REQUIRED"),
				arguments("name", quoted("a".repeat(61)), "name", "TOO_LONG"),
				arguments("name", quoted("a\\u0000b"), "name", "INVALID_FORMAT"),

				// A missing latitude is REQUIRED, not stored as 0.
				arguments("latitude", ABSENT, "latitude", "REQUIRED"), arguments("latitude", "null", "latitude", "REQUIRED"),
				arguments("latitude", "90.0000001", "latitude", "OUT_OF_RANGE"),
				arguments("latitude", "-90.0000001", "latitude", "OUT_OF_RANGE"),
				arguments("latitude", "1e400", "latitude", "OUT_OF_RANGE"),
				arguments("latitude", "-1e400", "latitude", "OUT_OF_RANGE"),
				// Jackson turns these strings into the real double values even with scalar coercion off, so this is how
				// NaN reaches the range check.
				arguments("latitude", quoted("NaN"), "latitude", "OUT_OF_RANGE"),
				arguments("latitude", quoted("Infinity"), "latitude", "OUT_OF_RANGE"),

				arguments("longitude", ABSENT, "longitude", "REQUIRED"),
				arguments("longitude", "null", "longitude", "REQUIRED"),
				arguments("longitude", "180.0000001", "longitude", "OUT_OF_RANGE"),
				arguments("longitude", "-180.0000001", "longitude", "OUT_OF_RANGE"),
				arguments("longitude", "1e400", "longitude", "OUT_OF_RANGE"),
				arguments("longitude", quoted("NaN"), "longitude", "OUT_OF_RANGE"),

				arguments("locationAccuracyM", "0", "locationAccuracyM", "OUT_OF_RANGE"),
				arguments("locationAccuracyM", "-1", "locationAccuracyM", "OUT_OF_RANGE"),
				arguments("locationAccuracyM", "1e400", "locationAccuracyM", "OUT_OF_RANGE"),
				arguments("locationAccuracyM", quoted("NaN"), "locationAccuracyM", "OUT_OF_RANGE"),
				arguments("locationAccuracyM", quoted("Infinity"), "locationAccuracyM", "OUT_OF_RANGE"),

				arguments("installation", ABSENT, "installation", "REQUIRED"),
				arguments("installation", "null", "installation", "REQUIRED"),

				arguments("installation.id", ABSENT, "installation.id", "REQUIRED"),
				arguments("installation.id", "null", "installation.id", "REQUIRED"),
				arguments("installation.id", quoted("not-a-uuid"), "installation.id", "INVALID_FORMAT"),
				arguments("installation.id", v4, "installation.id", "INVALID_FORMAT"),

				arguments("installation.occurredAt", ABSENT, "installation.occurredAt", "REQUIRED"),
				arguments("installation.occurredAt", "null", "installation.occurredAt", "REQUIRED"),
				arguments("installation.occurredAt", quoted("2026-11-03T09:20:00"), "installation.occurredAt",
						"INVALID_FORMAT"),
				arguments("installation.occurredAt", quoted("garbage"), "installation.occurredAt", "INVALID_FORMAT"),
				arguments("installation.occurredAt", quoted("1999-12-31T23:59:59Z"), "installation.occurredAt",
						"OUT_OF_RANGE"),
				arguments("installation.occurredAt",
						quoted(OffsetDateTime.now(ZoneOffset.UTC).plusMinutes(11).toString()), "installation.occurredAt",
						"OUT_OF_RANGE"));
	}

	@Test
	void emptyInstallationReportsBothNestedFields() throws Exception {
		String subject = newSubject();

		assertInvalid(createSite(subject, newProject(subject), siteBody("installation", "{}")),
				Map.of("installation.id", "REQUIRED", "installation.occurredAt", "REQUIRED"));
	}

	@Test
	void allInvalidFieldsAreReportedInOneResponseWithDottedNames() throws Exception {
		String subject = newSubject();

		MockHttpServletResponse response = createSite(subject, newProject(subject),
				siteBody("id", quoted("not-a-uuid"), "name", quoted(" "), "latitude", "91", "longitude", ABSENT,
						"locationAccuracyM", "0", "installation.id", ABSENT, "installation.occurredAt",
						quoted("2026-11-03T09:20:00")));

		assertInvalid(response,
				Map.of("id", "INVALID_FORMAT", "name", "REQUIRED", "latitude", "OUT_OF_RANGE", "longitude", "REQUIRED",
						"locationAccuracyM", "OUT_OF_RANGE", "installation.id", "REQUIRED", "installation.occurredAt",
						"INVALID_FORMAT"));
	}

	@ParameterizedTest
	@MethodSource("malformedValues")
	void wrongJsonTypeIsMalformedRequest(String key, String rawValue) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);

		assertProblem(createSite(subject, projectId, siteBody(key, rawValue)), 400, "MALFORMED_REQUEST");

		assertThat(siteCount(projectId)).isZero();
	}

	static Stream<Arguments> malformedValues() {
		return Stream.of(arguments("latitude", quoted("-26.9")), arguments("latitude", "true"),
				arguments("latitude", "NaN"), arguments("longitude", "Infinity"),
				arguments("locationAccuracyM", quoted("12.5")), arguments("id", "5"), arguments("name", "5"),
				arguments("installation", "5"), arguments("installation", "[]"), arguments("installation.id", "5"),
				arguments("installation.occurredAt", "1730000000"));
	}

	@Test
	void unreadableJsonIsMalformedRequest() throws Exception {
		String subject = newSubject();

		assertProblem(createSite(subject, newProject(subject), "{\"id\": "), 400, "MALFORMED_REQUEST");
	}

	// Access

	@Test
	void nonMemberGetsTheSame404AsMissingProjectEverywhereAndCreatesNothing() throws Exception {
		String owner = newSubject();
		String projectId = newProject(owner);
		String existingSiteId = UuidV7.generate().toString();
		createSite(owner, projectId, siteBody("id", quoted(existingSiteId)));
		String stranger = newSubject();
		String missingProject = UuidV7.generate().toString();
		String newSiteId = UuidV7.generate().toString();

		List<String> bodies = List.of(siteBody("id", quoted(newSiteId)), siteBody("id", quoted(existingSiteId)),
				// Never a validation error: it would say the request got past the access check.
				siteBody("id", quoted("not-a-uuid"), "latitude", ABSENT));
		for (String body : bodies) {
			assertSame404(createSite(stranger, projectId, body), createSite(stranger, missingProject, body));
		}
		assertSame404(perform(get(sitesPath(projectId)), stranger), perform(get(sitesPath(missingProject)), stranger));
		assertSame404(getSite(stranger, projectId, existingSiteId), getSite(stranger, missingProject, existingSiteId));

		assertThat(siteExists(newSiteId)).isFalse();
		assertThat(siteCount(projectId)).isEqualTo(1);
	}

	// Get

	@Test
	void getReturnsSite() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();
		createSite(subject, projectId, siteBody("id", quoted(siteId), "name", quoted("Isca 31")));

		MockHttpServletResponse response = getSite(subject, projectId, siteId);

		assertThat(response.getStatus()).isEqualTo(200);
		String body = bodyOf(response);
		assertThat(JsonPath.<Map<String, Object>>read(body, "$")).containsOnlyKeys("id", "name", "latitude", "longitude",
				"locationAccuracyM", "createdAt");
		assertThat(JsonPath.<String>read(body, "$.id")).isEqualTo(siteId);
		assertThat(JsonPath.<String>read(body, "$.name")).isEqualTo("Isca 31");
	}

	@Test
	void getOfMissingSiteIsBaitSiteNotFound() throws Exception {
		String subject = newSubject();

		assertProblem(getSite(subject, newProject(subject), UuidV7.generate().toString()), 404, "BAIT_SITE_NOT_FOUND");
	}

	// The caller is a member of both projects, so only the project filter in the query can stop this.
	@Test
	void siteOfAnotherProjectOfTheSameUserIsNotFoundWithTheSameBody() throws Exception {
		String subject = newSubject();
		String projectWithSite = newProject(subject);
		String otherProject = newProject(subject);
		String siteId = UuidV7.generate().toString();
		createSite(subject, projectWithSite, siteBody("id", quoted(siteId)));

		Map<String, Object> inOtherProject = assertProblem(getSite(subject, otherProject, siteId), 404,
				"BAIT_SITE_NOT_FOUND");
		Map<String, Object> missing = assertProblem(getSite(subject, otherProject, UuidV7.generate().toString()), 404,
				"BAIT_SITE_NOT_FOUND");

		assertThat(withoutInstance(inOtherProject)).isEqualTo(withoutInstance(missing));
	}

	@Test
	void malformedSiteIdIsMalformedRequest() throws Exception {
		String subject = newSubject();

		assertProblem(getSite(subject, newProject(subject), "not-a-uuid"), 400, "MALFORMED_REQUEST");
	}

	// List

	@Test
	void listReturnsOnlySitesOfThisProjectInCreationOrder() throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String otherProject = newProject(subject);
		String first = UuidV7.generate().toString();
		String second = UuidV7.generate().toString();
		String third = UuidV7.generate().toString();
		createSite(subject, projectId, siteBody("id", quoted(first), "name", quoted("First")));
		createSite(subject, otherProject, siteBody("name", quoted("Of the other project")));
		createSite(subject, projectId, siteBody("id", quoted(second), "name", quoted("Second")));
		createSite(subject, projectId, siteBody("id", quoted(third), "name", quoted("Third")));

		MockHttpServletResponse response = perform(get(sitesPath(projectId)), subject);

		assertThat(response.getStatus()).isEqualTo(200);
		String body = bodyOf(response);
		assertThat(JsonPath.<Map<String, Object>>read(body, "$")).containsOnlyKeys("items");
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].id")).containsExactly(first, second, third);
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].name")).containsExactly("First", "Second", "Third");
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].createdAt")).hasSize(3).doesNotContainNull();
	}

	@Test
	void projectWithoutSitesGetsEmptyItems() throws Exception {
		String subject = newSubject();

		MockHttpServletResponse response = perform(get(sitesPath(newProject(subject))), subject);

		assertThat(response.getStatus()).isEqualTo(200);
		assertThat(JsonPath.<Map<String, Object>>read(bodyOf(response), "$")).containsOnlyKeys("items");
		assertThat(JsonPath.<List<Object>>read(bodyOf(response), "$.items")).isEmpty();
	}

	// Logging

	@Test
	void createLogsIdsAndNeverNameOrCoordinates(CapturedOutput output) throws Exception {
		String subject = newSubject();
		String projectId = newProject(subject);
		String siteId = UuidV7.generate().toString();

		createSite(subject, projectId, siteBody("id", quoted(siteId), "name", quoted("Isca do Quintal"), "latitude",
				"-26.91937", "longitude", "-49.06613"));

		String line = "Bait site created: baitSiteId=" + siteId + " projectId=" + projectId + " userId="
				+ userId(subject);
		assertThat(output.getOut().lines().filter((logLine) -> logLine.contains(line))).singleElement()
			.satisfies((logLine) -> assertThat(logLine).contains("INFO"));
		assertThat(output.getAll()).doesNotContain("Isca do Quintal", "26.91937", "49.06613", "eyJ");
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

	private static void assertAccuracyIsNullButKeyIsPresent(String body) {
		Map<String, Object> site = JsonPath.read(body, "$");
		assertThat(site).containsKey("locationAccuracyM");
		assertThat(site.get("locationAccuracyM")).isNull();
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

	private MockHttpServletResponse createSite(String subject, String projectId, String body) throws Exception {
		return perform(post(sitesPath(projectId)).contentType(MediaType.APPLICATION_JSON).content(body), subject);
	}

	private MockHttpServletResponse getSite(String subject, String projectId, String siteId) throws Exception {
		return perform(get(sitesPath(projectId) + "/" + siteId), subject);
	}

	private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String subject) throws Exception {
		return this.mockMvc.perform(request.header("Authorization", "Bearer " + TestTokens.trusted(subject)))
			.andReturn()
			.getResponse();
	}

	private static String sitesPath(String projectId) {
		return "/api/projects/" + projectId + "/bait-sites";
	}

	/**
	 * A valid body, with some fields replaced by raw JSON, or removed with {@link #ABSENT}. Raw because several tests
	 * send what a JSON library would refuse to write, such as NaN or 1e400. Nested fields use dotted names.
	 */
	private static String siteBody(String... keysAndRawValues) {
		Map<String, String> site = new LinkedHashMap<>();
		site.put("id", quoted(UuidV7.generate().toString()));
		site.put("name", quoted("Isca 31"));
		site.put("latitude", "-26.9194");
		site.put("longitude", "-49.0661");
		site.put("locationAccuracyM", "12.5");
		Map<String, String> installation = new LinkedHashMap<>();
		installation.put("id", quoted(UuidV7.generate().toString()));
		installation.put("occurredAt", quoted(OffsetDateTime.now(ZoneOffset.ofHours(-3)).minusHours(1).toString()));

		boolean installationReplaced = false;
		for (int i = 0; i < keysAndRawValues.length; i += 2) {
			String key = keysAndRawValues[i];
			String rawValue = keysAndRawValues[i + 1];
			if (key.startsWith("installation.")) {
				put(installation, key.substring("installation.".length()), rawValue);
			}
			else {
				installationReplaced |= key.equals("installation");
				put(site, key, rawValue);
			}
		}
		if (!installationReplaced) {
			site.put("installation", object(installation));
		}
		return object(site);
	}

	private static void put(Map<String, String> fields, String key, String rawValue) {
		if (ABSENT.equals(rawValue)) {
			fields.remove(key);
		}
		else {
			fields.put(key, rawValue);
		}
	}

	private static String object(Map<String, String> fields) {
		return fields.entrySet()
			.stream()
			.map((field) -> quoted(field.getKey()) + ": " + field.getValue())
			.collect(Collectors.joining(", ", "{", "}"));
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

	private String storedName(String siteId) {
		return this.jdbcClient.sql("SELECT name FROM bait_sites WHERE id = ?::uuid")
			.param(siteId)
			.query(String.class)
			.single();
	}

	private boolean siteExists(String siteId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_sites WHERE id = ?::uuid")
			.param(siteId)
			.query(Long.class)
			.single() > 0;
	}

	private boolean eventExists(String eventId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_site_events WHERE id = ?::uuid")
			.param(eventId)
			.query(Long.class)
			.single() > 0;
	}

	private long siteCount(String projectId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_sites WHERE project_id = ?::uuid")
			.param(projectId)
			.query(Long.class)
			.single();
	}

	private long eventCount(String siteId) {
		return this.jdbcClient.sql("SELECT count(*) FROM bait_site_events WHERE bait_site_id = ?::uuid")
			.param(siteId)
			.query(Long.class)
			.single();
	}

}
