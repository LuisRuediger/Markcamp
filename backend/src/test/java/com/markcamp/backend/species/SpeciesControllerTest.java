package com.markcamp.backend.species;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.markcamp.backend.PostgresTestContainer;
import com.markcamp.backend.TestTokens;

/**
 * Each request comes from a new user, who has no projects: the list needs no membership.
 */
@SpringBootTest
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class SpeciesControllerTest implements PostgresTestContainer {

	@TestBean(methodName = "com.markcamp.backend.TestTokens#jwtDecoder")
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Test
	void listsTheSeededSpeciesOrderedByScientificNameForAUserWithNoProjects() throws Exception {
		MockHttpServletResponse response = listSpecies();

		assertThat(response.getStatus()).isEqualTo(200);
		String body = response.getContentAsString(StandardCharsets.UTF_8);
		assertThat(JsonPath.<Map<String, Object>>read(body, "$")).containsOnlyKeys("items");
		assertThat(JsonPath.<List<String>>read(body, "$.items[*].scientificName")).containsExactly("Friesella schrottkyi",
				"Melipona bicolor", "Melipona marginata", "Melipona quadrifasciata", "Melipona sp.",
				"Nannotrigona testaceicornis", "Plebeia droryana", "Plebeia emerina", "Plebeia remota", "Plebeia sp.",
				"Scaptotrigona bipunctata", "Scaptotrigona depilis", "Scaptotrigona sp.", "Scaptotrigona xanthotricha",
				"Tetragona clavipes", "Tetragonisca angustula");
		JsonPath.<List<Map<String, Object>>>read(body, "$.items[*]")
			.forEach((item) -> assertThat(item).containsOnlyKeys("id", "scientificName", "commonName"));
		assertThat(JsonPath.<Map<String, Object>>read(body, "$.items[15]"))
			.containsEntry("id", "01a17fce-7800-77ac-81e1-875a2a5b870c")
			.containsEntry("commonName", "Jataí");
	}

	// Locks the decision of no HTTP caching: the app keeps its own offline copy, so a max-age or an ETag here would be a
	// second copy to invalidate.
	@Test
	void isNotCachedOverHttp() throws Exception {
		assertThat(listSpecies().getHeader("Cache-Control")).contains("no-store");
	}

	private MockHttpServletResponse listSpecies() throws Exception {
		String subject = "test-" + UUID.randomUUID();
		return this.mockMvc.perform(get("/api/species").header("Authorization", "Bearer " + TestTokens.trusted(subject)))
			.andReturn()
			.getResponse();
	}

}
