package com.markcamp.backend.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.startsWith;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.test.web.servlet.MockMvc;

import com.jayway.jsonpath.JsonPath;
import com.markcamp.backend.auth.FirebaseTokenValidators;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * Sends real signed tokens through the whole filter chain, so the JWT to principal converter and provisioning run.
 */
@SpringBootTest
@AutoConfigureMockMvc
class MeControllerTest {

	// Must match src/test/resources/config/application.properties.
	private static final String PROJECT_ID = "markcamp-test";

	private static final KeyPair TRUSTED_KEY = generateRsaKeyPair();

	private static final KeyPair UNTRUSTED_KEY = generateRsaKeyPair();

	// Replaces the production decoder: same validators, but a key generated here instead of Google's.
	@TestBean
	JwtDecoder jwtDecoder;

	@Autowired
	MockMvc mockMvc;

	@Autowired
	JdbcClient jdbcClient;

	private final List<String> createdSubjects = new ArrayList<>();

	static JwtDecoder jwtDecoder() {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey((RSAPublicKey) TRUSTED_KEY.getPublic())
			.signatureAlgorithm(SignatureAlgorithm.RS256)
			.build();
		decoder.setJwtValidator(FirebaseTokenValidators.create(PROJECT_ID));
		return decoder;
	}

	@AfterEach
	void deleteTestUsers() {
		if (!this.createdSubjects.isEmpty()) {
			this.jdbcClient.sql("DELETE FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject IN (:subjects)")
				.param("subjects", this.createdSubjects)
				.update();
		}
	}

	@Test
	void rejectsRequestWithoutToken() throws Exception {
		this.mockMvc.perform(get("/api/me"))
			.andExpect(status().isUnauthorized())
			// Spring Security 7 appends resource_metadata="..." (RFC 9728) after the scheme.
			.andExpect(header().string("WWW-Authenticate", startsWith("Bearer")));
	}

	@Test
	void rejectsGarbageToken() throws Exception {
		this.mockMvc.perform(get("/api/me").header("Authorization", "Bearer not-a-token"))
			.andExpect(status().isUnauthorized());
	}

	@Test
	void rejectsTokenSignedByAnotherKey() throws Exception {
		String token = signedToken(newSubject(), UNTRUSTED_KEY);
		this.mockMvc.perform(get("/api/me").header("Authorization", "Bearer " + token))
			.andExpect(status().isUnauthorized());
	}

	@Test
	void returnsInternalIdOfProvisionedUser() throws Exception {
		String subject = newSubject();

		UUID id = me(subject);

		assertThat(id.version()).isEqualTo(7);
		assertThat(idInDatabase(subject)).isEqualTo(id);
	}

	@Test
	void sameSubjectGetsSameUser() throws Exception {
		String subject = newSubject();

		UUID first = me(subject);
		UUID second = me(subject);

		assertThat(second).isEqualTo(first);
		assertThat(rowCount(subject)).isEqualTo(1);
	}

	@Test
	void differentSubjectsGetDifferentUsers() throws Exception {
		assertThat(me(newSubject())).isNotEqualTo(me(newSubject()));
	}

	private UUID me(String subject) throws Exception {
		String body = this.mockMvc
			.perform(get("/api/me").header("Authorization", "Bearer " + signedToken(subject, TRUSTED_KEY)))
			.andExpect(status().isOk())
			.andReturn()
			.getResponse()
			.getContentAsString();
		return UUID.fromString(JsonPath.read(body, "$.id"));
	}

	private String newSubject() {
		String subject = "test-" + UUID.randomUUID();
		this.createdSubjects.add(subject);
		return subject;
	}

	private UUID idInDatabase(String subject) {
		return this.jdbcClient.sql("SELECT id FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject = ?")
			.param(subject)
			.query(UUID.class)
			.single();
	}

	private int rowCount(String subject) {
		return this.jdbcClient.sql("SELECT count(*) FROM users WHERE auth_provider = 'FIREBASE' AND auth_subject = ?")
			.param(subject)
			.query(Integer.class)
			.single();
	}

	private static String signedToken(String subject, KeyPair key) throws JOSEException {
		Instant now = Instant.now();
		JWTClaimsSet claims = new JWTClaimsSet.Builder()
			.issuer("https://securetoken.google.com/" + PROJECT_ID)
			.audience(PROJECT_ID)
			.subject(subject)
			.issueTime(Date.from(now))
			.expirationTime(Date.from(now.plusSeconds(3600)))
			.claim("auth_time", now.getEpochSecond())
			.build();
		SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).build(),
				claims);
		jwt.sign(new RSASSASigner(key.getPrivate()));
		return jwt.serialize();
	}

	private static KeyPair generateRsaKeyPair() {
		try {
			KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
			generator.initialize(2048);
			return generator.generateKeyPair();
		}
		catch (NoSuchAlgorithmException ex) {
			throw new IllegalStateException(ex);
		}
	}

}
