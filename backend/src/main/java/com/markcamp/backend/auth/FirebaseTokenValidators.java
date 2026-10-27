package com.markcamp.backend.auth;

import java.time.Duration;
import java.time.Instant;

import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2ErrorCodes;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtAudienceValidator;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.JwtTimestampValidator;
import org.springframework.util.Assert;

/**
 * Claim checks for Firebase ID tokens (ADR 0004, rule 3), following Firebase's rules for verifying ID tokens
 * with a third-party JWT library. The signature and algorithm are checked by the decoder, not here.
 * Production and tests build their validators through {@link #create(String)}, so both check exactly the same.
 */
public final class FirebaseTokenValidators {

	static final Duration CLOCK_SKEW = Duration.ofSeconds(60);

	static final String ISSUER_PREFIX = "https://securetoken.google.com/";

	static final String AUTH_TIME = "auth_time";

	// Same limit as users.auth_subject (V1), so an oversized sub is a 401 instead of a constraint violation.
	static final int MAX_SUBJECT_LENGTH = 255;

	private FirebaseTokenValidators() {
	}

	public static OAuth2TokenValidator<Jwt> create(String projectId) {
		Assert.hasText(projectId, "projectId must not be blank");

		// Checks exp and nbf. Spring accepts a token without exp by default; Firebase tokens always have one.
		JwtTimestampValidator timestamps = new JwtTimestampValidator(CLOCK_SKEW);
		timestamps.setAllowEmptyExpiryClaim(false);

		return new DelegatingOAuth2TokenValidator<>(
				timestamps,
				new JwtIssuerValidator(ISSUER_PREFIX + projectId),
				// Spring Security never checks aud unless a validator is added for it.
				new JwtAudienceValidator(projectId),
				// Not JwtIssuedAtValidator: it also rejects an iat older than the skew, which every token
				// past its first minute has.
				presentAndNotInFuture(JwtClaimNames.IAT),
				presentAndNotInFuture(AUTH_TIME),
				FirebaseTokenValidators::validateSubject);
	}

	private static OAuth2TokenValidator<Jwt> presentAndNotInFuture(String claim) {
		return (jwt) -> {
			Instant value;
			try {
				value = jwt.getClaimAsInstant(claim);
			}
			catch (IllegalArgumentException ex) {
				// Not a timestamp (e.g. a string): reject the token instead of failing the request with a 500.
				value = null;
			}
			if (value == null || value.isAfter(Instant.now().plus(CLOCK_SKEW))) {
				return failure("The " + claim + " claim is missing or in the future");
			}
			return OAuth2TokenValidatorResult.success();
		};
	}

	private static OAuth2TokenValidatorResult validateSubject(Jwt jwt) {
		String subject = jwt.getSubject();
		if (subject == null || subject.isBlank() || subject.length() > MAX_SUBJECT_LENGTH) {
			return failure("The sub claim is missing, blank or too long");
		}
		return OAuth2TokenValidatorResult.success();
	}

	private static OAuth2TokenValidatorResult failure(String description) {
		return OAuth2TokenValidatorResult.failure(new OAuth2Error(OAuth2ErrorCodes.INVALID_TOKEN, description, null));
	}

}
