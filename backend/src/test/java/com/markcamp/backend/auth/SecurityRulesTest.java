package com.markcamp.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;

import org.assertj.core.api.InstanceOfAssertFactories;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;

/**
 * Spring Security 7 imposes a public RFC 9728 endpoint; this pins its content and that everything else needs a token.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SecurityRulesTest {

	@Autowired
	MockMvc mockMvc;

	@Test
	void protectedResourceMetadataIsPublicAndMinimal() throws Exception {
		String body = this.mockMvc.perform(get("/.well-known/oauth-protected-resource"))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();

		Map<String, Object> metadata = JsonPath.read(body, "$");
		assertThat(metadata.keySet()).containsExactlyInAnyOrder("resource", "bearer_methods_supported",
				"tls_client_certificate_bound_access_tokens");
		assertThat(metadata.get("bearer_methods_supported")).asInstanceOf(InstanceOfAssertFactories.LIST)
			.containsExactly("header");
		assertThat(metadata.get("tls_client_certificate_bound_access_tokens")).isEqualTo(false);
	}

	@Test
	void unknownPathRequiresToken() throws Exception {
		this.mockMvc.perform(get("/api/does-not-exist")).andExpect(status().isUnauthorized());
	}

	@Test
	void everyMethodRequiresToken() throws Exception {
		this.mockMvc.perform(post("/api/me")).andExpect(status().isUnauthorized());
	}

}
