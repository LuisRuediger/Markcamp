package com.markcamp.backend.common;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Standalone MockMvc: no Spring context, but the body is still serialized, so what the client would read is checked.
 */
class ApiExceptionHandlerTest {

	private static final String SQL_MESSAGE = "SELECT * FROM users";

	private static final String CONSTRAINT_MESSAGE = "duplicate key violates constraint projects_pkey";

	private final MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new FailingController())
		.setControllerAdvice(new ApiExceptionHandler())
		.build();

	@Test
	void unexpectedExceptionBecomesInternalErrorWithoutItsMessage() throws Exception {
		String body = expectInternalError("/runtime-exception");

		assertThat(body).doesNotContain(SQL_MESSAGE);
	}

	@Test
	void escapedConstraintViolationBecomesInternalError() throws Exception {
		String body = expectInternalError("/constraint-violation");

		assertThat(body).doesNotContain("projects_pkey");
	}

	private String expectInternalError(String path) throws Exception {
		return this.mockMvc.perform(get(path))
			.andExpect(status().isInternalServerError())
			.andExpect(content().contentType(MediaType.APPLICATION_PROBLEM_JSON))
			.andExpect(jsonPath("$.code").value("INTERNAL_ERROR"))
			.andReturn()
			.getResponse()
			.getContentAsString();
	}

	@RestController
	static class FailingController {

		@GetMapping("/runtime-exception")
		void runtimeException() {
			throw new RuntimeException(SQL_MESSAGE);
		}

		@GetMapping("/constraint-violation")
		void constraintViolation() {
			throw new DataIntegrityViolationException(CONSTRAINT_MESSAGE);
		}

	}

}
