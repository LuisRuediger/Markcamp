package com.markcamp.backend.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
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
 * No MockMvc printing: when a test fails it prints the Authorization header, and the captured output covers the whole
 * class, so one failure would also fail the check that the application never logs tokens.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
@ExtendWith(OutputCaptureExtension.class)
class ProjectControllerTest implements PostgresTestContainer {

	private static final List<String> PROBLEM_KEYS = List.of("type", "title", "status", "detail", "instance", "code",
			"errors");

	@TestBean(methodName = "com.markcamp.backend.TestTokens#jwtDecoder")
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JdbcClient jdbcClient;

	// Create

	@Test
	void createReturnsProjectAndStoresOwnerMembership() throws Exception {
		String subject = newSubject();
		String id = UuidV7.generate().toString();

		MockHttpServletResponse response = createProject(subject, json(id, "Sítio Norte"));

		assertThat(response.getStatus()).isEqualTo(201);
		assertThat(response.getHeader("Location")).isEqualTo("/api/projects/" + id);
		String body = bodyOf(response);
		assertThat(JsonPath.<String>read(body, "$.id")).isEqualTo(id);
		assertThat(JsonPath.<String>read(body, "$.name")).isEqualTo("Sítio Norte");
		assertThat(JsonPath.<String>read(body, "$.role")).isEqualTo("OWNER");
		assertThat(JsonPath.<String>read(body, "$.createdAt")).isNotBlank();

		UUID userId = userId(subject);
		assertThat(this.jdbcClient.sql("SELECT created_by FROM projects WHERE id = ?::uuid")
			.param(id)
			.query(UUID.class)
			.list()).containsExactly(userId);
		assertThat(this.jdbcClient.sql("SELECT role FROM project_members WHERE project_id = ?::uuid AND user_id = ?")
			.params(id, userId)
			.query(String.class)
			.list()).containsExactly("OWNER");
	}

	@Test
	void createWithExistingIdIsConflictAndChangesNothing() throws Exception {
		String subject = newSubject();
		String id = UuidV7.generate().toString();
		createProject(subject, json(id, "Original"));

		MockHttpServletResponse response = createProject(subject, json(id, "Different"));

		assertProblem(response, 409, "ID_ALREADY_EXISTS");
		assertThat(storedName(id)).isEqualTo("Original");
	}

	@Test
	void createWithIdOfAnotherUsersProjectIsConflictAndGrantsNoAccess() throws Exception {
		String id = UuidV7.generate().toString();
		createProject(newSubject(), json(id, "Original"));
		String otherUser = newSubject();

		assertProblem(createProject(otherUser, json(id, "Mine now")), 409, "ID_ALREADY_EXISTS");

		assertProblem(perform(get("/api/projects/" + id), otherUser), 404, "PROJECT_NOT_FOUND");
		assertThat(storedName(id)).isEqualTo("Original");
	}

	@Test
	void createTrimsName() throws Exception {
		String id = UuidV7.generate().toString();

		MockHttpServletResponse response = createProject(newSubject(), json(id, "  Sítio Norte  "));

		assertThat(JsonPath.<String>read(bodyOf(response), "$.name")).isEqualTo("Sítio Norte");
		assertThat(storedName(id)).isEqualTo("Sítio Norte");
	}

	@Test
	void createTrimsUnicodeSpacesFromName() throws Exception {
		String id = UuidV7.generate().toString();

		MockHttpServletResponse response = createProject(newSubject(), json(id, " Sítio "));

		assertThat(response.getStatus()).isEqualTo(201);
		assertThat(JsonPath.<String>read(bodyOf(response), "$.name")).isEqualTo("Sítio");
		assertThat(storedName(id)).isEqualTo("Sítio");
	}

	@Test
	void createKeepsUnicodeSpaceInsideName() throws Exception {
		String id = UuidV7.generate().toString();

		MockHttpServletResponse response = createProject(newSubject(), json(id, "Isca 31"));

		assertThat(response.getStatus()).isEqualTo(201);
		assertThat(storedName(id)).isEqualTo("Isca 31");
	}

	@Test
	void createAcceptsHundredEmoji() throws Exception {
		String id = UuidV7.generate().toString();
		String name = "🐝".repeat(100);

		MockHttpServletResponse response = createProject(newSubject(), json(id, name));

		assertThat(response.getStatus()).isEqualTo(201);
		assertThat(storedName(id)).isEqualTo(name);
	}

	// Validation

	@Test
	void missingIdIsRequired() throws Exception {
		assertInvalid("{\"name\": \"Valid\"}", Map.of("id", "REQUIRED"));
	}

	@Test
	void nullIdIsRequired() throws Exception {
		assertInvalid("{\"id\": null, \"name\": \"Valid\"}", Map.of("id", "REQUIRED"));
	}

	@Test
	void malformedIdIsInvalidFormat() throws Exception {
		assertInvalid(json("not-a-uuid", "Valid"), Map.of("id", "INVALID_FORMAT"));
	}

	@Test
	void v4IdIsInvalidFormat() throws Exception {
		assertInvalid(json(UUID.randomUUID().toString(), "Valid"), Map.of("id", "INVALID_FORMAT"));
	}

	@Test
	void nonCanonicalIdIsInvalidFormat() throws Exception {
		assertInvalid(json("1-1-1-1-1", "Valid"), Map.of("id", "INVALID_FORMAT"));
	}

	@Test
	void missingNameIsRequired() throws Exception {
		assertInvalid("{\"id\": \"" + UuidV7.generate() + "\"}", Map.of("name", "REQUIRED"));
	}

	@Test
	void blankNameIsRequired() throws Exception {
		assertInvalid(json(UuidV7.generate().toString(), "   "), Map.of("name", "REQUIRED"));
	}

	@Test
	void nameOfOnlyUnicodeSpacesIsRequired() throws Exception {
		assertInvalid(json(UuidV7.generate().toString(), "  "), Map.of("name", "REQUIRED"));
	}

	// Escaped in the JSON, because Jackson itself rejects a raw control character inside a string.
	@ParameterizedTest
	@ValueSource(strings = { "a\\u0000b", "a\\nb", "a\\tb" })
	void controlCharacterInNameIsInvalidFormatAndCreatesNothing(String name) throws Exception {
		String id = UuidV7.generate().toString();

		assertInvalid(json(id, name), Map.of("name", "INVALID_FORMAT"));

		assertThat(this.jdbcClient.sql("SELECT count(*) FROM projects WHERE id = ?::uuid")
			.param(id)
			.query(Long.class)
			.single()).isZero();
	}

	@Test
	void nameOver100CharactersIsTooLong() throws Exception {
		assertInvalid(json(UuidV7.generate().toString(), "a".repeat(101)), Map.of("name", "TOO_LONG"));
	}

	@Test
	void allInvalidFieldsAreReportedInOneResponse() throws Exception {
		assertInvalid(json("not-a-uuid", "   "), Map.of("id", "INVALID_FORMAT", "name", "REQUIRED"));
	}

	@Test
	void malformedJsonIsMalformedRequest() throws Exception {
		assertProblem(createProject(newSubject(), "{\"id\": "), 400, "MALFORMED_REQUEST");
	}

	@Test
	void numberAsNameIsMalformedRequest() throws Exception {
		String body = "{\"id\": \"%s\", \"name\": 5}".formatted(UuidV7.generate());

		assertProblem(createProject(newSubject(), body), 400, "MALFORMED_REQUEST");
	}

	@Test
	void booleanAsNameIsMalformedRequest() throws Exception {
		String body = "{\"id\": \"%s\", \"name\": true}".formatted(UuidV7.generate());

		assertProblem(createProject(newSubject(), body), 400, "MALFORMED_REQUEST");
	}

	@Test
	void numberAsIdIsMalformedRequest() throws Exception {
		assertProblem(createProject(newSubject(), "{\"id\": 123, \"name\": \"Valid\"}"), 400, "MALFORMED_REQUEST");
	}

	// List

	@Test
	void listReturnsOnlyProjectsOfCaller() throws Exception {
		String subject = newSubject();
		String first = UuidV7.generate().toString();
		String second = UuidV7.generate().toString();
		createProject(subject, json(first, "First"));
		createProject(subject, json(second, "Second"));
		createProject(newSubject(), json(UuidV7.generate().toString(), "Of someone else"));

		MockHttpServletResponse response = perform(get("/api/projects"), subject);

		assertThat(response.getStatus()).isEqualTo(200);
		String body = bodyOf(response);
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].id")).containsExactly(first, second);
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].role")).containsExactly("OWNER", "OWNER");
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].name")).containsExactly("First", "Second");
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].createdAt")).hasSize(2).doesNotContainNull();
	}

	@Test
	void userWithoutProjectsGetsEmptyItems() throws Exception {
		MockHttpServletResponse response = perform(get("/api/projects"), newSubject());

		assertThat(response.getStatus()).isEqualTo(200);
		assertThat(JsonPath.<Map<String, Object>>read(bodyOf(response), "$")).containsOnlyKeys("items");
		assertThat(JsonPath.<List<Object>>read(bodyOf(response), "$.items")).isEmpty();
	}

	// Get

	@Test
	void getAsMemberReturnsProject() throws Exception {
		String subject = newSubject();
		String id = UuidV7.generate().toString();
		createProject(subject, json(id, "Mine"));

		MockHttpServletResponse response = perform(get("/api/projects/" + id), subject);

		assertThat(response.getStatus()).isEqualTo(200);
		String body = bodyOf(response);
		assertThat(JsonPath.<String>read(body, "$.id")).isEqualTo(id);
		assertThat(JsonPath.<String>read(body, "$.name")).isEqualTo("Mine");
		assertThat(JsonPath.<String>read(body, "$.role")).isEqualTo("OWNER");
		assertThat(JsonPath.<String>read(body, "$.createdAt")).isNotBlank();
	}

	@Test
	void nonMemberAndMissingProjectGetTheSame404() throws Exception {
		String id = UuidV7.generate().toString();
		createProject(newSubject(), json(id, "Of someone else"));
		String stranger = newSubject();

		Map<String, Object> nonMember = assertProblem(perform(get("/api/projects/" + id), stranger), 404,
				"PROJECT_NOT_FOUND");
		Map<String, Object> missing = assertProblem(perform(get("/api/projects/" + UuidV7.generate()), stranger), 404,
				"PROJECT_NOT_FOUND");

		assertThat(withoutInstance(nonMember)).isEqualTo(withoutInstance(missing));
	}

	@Test
	void malformedPathParameterIsMalformedRequest() throws Exception {
		assertProblem(perform(get("/api/projects/not-a-uuid"), newSubject()), 400, "MALFORMED_REQUEST");
	}

	// Framework errors, with a valid token

	@Test
	void unknownPathIsResourceNotFound() throws Exception {
		assertProblem(perform(get("/api/does-not-exist"), newSubject()), 404, "RESOURCE_NOT_FOUND");
	}

	@Test
	void wrongMethodIsMethodNotAllowed() throws Exception {
		assertProblem(perform(delete("/api/projects/" + UuidV7.generate()), newSubject()), 405, "METHOD_NOT_ALLOWED");
	}

	@Test
	void wrongContentTypeIsUnsupportedMediaType() throws Exception {
		MockHttpServletResponse response = perform(
				post("/api/projects").contentType(MediaType.TEXT_PLAIN).content("not json"), newSubject());

		assertProblem(response, 415, "UNSUPPORTED_MEDIA_TYPE");
	}

	// Logging

	@Test
	void nonMemberAccessIsLoggedWithInternalIdsOnly(CapturedOutput output) throws Exception {
		String id = UuidV7.generate().toString();
		createProject(newSubject(), json(id, "Of someone else"));
		String stranger = newSubject();

		perform(get("/api/projects/" + id), stranger);

		String line = "Project access denied: userId=" + userId(stranger) + " projectId=" + id;
		assertThat(output.getOut().lines().filter((logLine) -> logLine.contains(line))).singleElement()
			.satisfies((logLine) -> assertThat(logLine).contains("WARN"));
		assertThat(output.getAll()).doesNotContain("eyJ");
	}

	private void assertInvalid(String body, Map<String, String> expected) throws Exception {
		Map<String, Object> problem = assertProblem(createProject(newSubject(), body), 400, "VALIDATION_FAILED");
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

	private MockHttpServletResponse createProject(String subject, String body) throws Exception {
		return perform(post("/api/projects").contentType(MediaType.APPLICATION_JSON).content(body), subject);
	}

	private MockHttpServletResponse perform(MockHttpServletRequestBuilder request, String subject) throws Exception {
		return this.mockMvc.perform(request.header("Authorization", "Bearer " + TestTokens.trusted(subject)))
			.andReturn()
			.getResponse();
	}

	private static String bodyOf(MockHttpServletResponse response) throws Exception {
		return response.getContentAsString(StandardCharsets.UTF_8);
	}

	private static String json(String id, String name) {
		return "{\"id\": \"%s\", \"name\": \"%s\"}".formatted(id, name);
	}

	private String newSubject() {
		return "test-" + UUID.randomUUID();
	}

	private UUID userId(String subject) {
		return this.jdbcClient.sql("SELECT id FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject = ?")
			.param(subject)
			.query(UUID.class)
			.single();
	}

	private String storedName(String id) {
		return this.jdbcClient.sql("SELECT name FROM projects WHERE id = ?::uuid").param(id).query(String.class).single();
	}

}
