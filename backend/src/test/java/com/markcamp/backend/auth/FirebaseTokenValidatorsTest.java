package com.markcamp.backend.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.Jwt;

class FirebaseTokenValidatorsTest {

	private static final String PROJECT_ID = "markcamp-test";

	private final OAuth2TokenValidator<Jwt> validator = FirebaseTokenValidators.create(PROJECT_ID);

	@Test
	void acceptsValidToken() {
		assertThat(this.validator.validate(validToken().build()).hasErrors()).isFalse();
	}

	@Test
	void rejectsWrongAudience() {
		assertRejected(validToken().audience(List.of("another-project")));
	}

	@Test
	void rejectsWrongIssuer() {
		assertRejected(validToken().issuer("https://securetoken.google.com/another-project"));
	}

	@Test
	void rejectsExpiredToken() {
		Instant now = Instant.now();
		assertRejected(validToken().issuedAt(now.minusSeconds(7200)).expiresAt(now.minusSeconds(3600)));
	}

	@Test
	void rejectsIssuedAtInTheFuture() {
		Instant now = Instant.now();
		assertRejected(validToken().issuedAt(now.plusSeconds(3600)).expiresAt(now.plusSeconds(7200)));
	}

	@Test
	void rejectsMissingAuthTime() {
		assertRejected(validToken().claims((claims) -> claims.remove(FirebaseTokenValidators.AUTH_TIME)));
	}

	@Test
	void rejectsBlankSubject() {
		assertRejected(validToken().subject("  "));
	}

	@Test
	void rejectsSubjectLongerThan255Characters() {
		assertRejected(validToken().subject("a".repeat(256)));
	}

	private void assertRejected(Jwt.Builder token) {
		assertThat(this.validator.validate(token.build()).hasErrors()).isTrue();
	}

	// Shaped like a decoded Firebase ID token: auth_time stays a number of seconds, as in the real payload.
	private static Jwt.Builder validToken() {
		Instant now = Instant.now();
		return Jwt.withTokenValue("token")
			.header("alg", "RS256")
			.issuer("https://securetoken.google.com/" + PROJECT_ID)
			.audience(List.of(PROJECT_ID))
			.subject("test-user")
			.issuedAt(now.minusSeconds(600))
			.expiresAt(now.plusSeconds(3000))
			.claim(FirebaseTokenValidators.AUTH_TIME, now.minusSeconds(600).getEpochSecond());
	}

}
