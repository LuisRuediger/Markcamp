package com.markcamp.backend.auth;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.util.Assert;

import com.markcamp.backend.user.UserProvisioningService;

@Configuration
class SecurityConfig {

	// Firebase's signing keys in JWK format. Firebase's docs only list the x509 form of the same keys
	// (https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com, same key ids);
	// NimbusJwtDecoder needs JWK. If this endpoint ever stops working, the x509 one is the documented fallback.
	private static final String FIREBASE_JWK_SET_URI =
			"https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

	@Bean
	SecurityFilterChain securityFilterChain(HttpSecurity http, UserProvisioningService provisioningService)
			throws Exception {
		http
			.authorizeHttpRequests((authorize) -> authorize.anyRequest().authenticated())
			// Bearer tokens only: no session, no cookies, so no CSRF.
			.sessionManagement((session) -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
			.csrf(AbstractHttpConfigurer::disable)
			.httpBasic(AbstractHttpConfigurer::disable)
			.formLogin(AbstractHttpConfigurer::disable)
			.oauth2ResourceServer((resourceServer) -> resourceServer
				.jwt((jwt) -> jwt.jwtAuthenticationConverter(new FirebaseJwtAuthenticationConverter(provisioningService)))
				// Spring Security always publishes public RFC 9728 metadata at /.well-known/oauth-protected-resource
				// (and links it from WWW-Authenticate); it cannot be turned off. Its default claims mTLS-bound
				// tokens, which Firebase ID tokens are not.
				.protectedResourceMetadata((metadata) -> metadata
					.protectedResourceMetadataCustomizer((builder) -> builder.tlsClientCertificateBoundAccessTokens(false))));
		return http.build();
	}

	// Built explicitly instead of through issuer-uri discovery: the keys are fetched lazily and cached,
	// so startup makes no call to Google and each request is validated locally (ADR 0004, rule 4).
	@Bean
	JwtDecoder jwtDecoder(@Value("${markcamp.auth.firebase.project-id}") String projectId) {
		Assert.hasText(projectId, "markcamp.auth.firebase.project-id must not be blank (set FIREBASE_PROJECT_ID)");
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(FIREBASE_JWK_SET_URI)
			.jwsAlgorithm(SignatureAlgorithm.RS256)
			.build();
		decoder.setJwtValidator(FirebaseTokenValidators.create(projectId));
		return decoder;
	}

}
