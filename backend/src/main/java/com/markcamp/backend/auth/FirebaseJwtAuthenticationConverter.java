package com.markcamp.backend.auth;

import java.util.List;
import java.util.UUID;

import org.springframework.core.convert.converter.Converter;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.web.authentication.preauth.PreAuthenticatedAuthenticationToken;

import com.markcamp.backend.user.AuthProvider;
import com.markcamp.backend.user.UserProvisioningService;

/**
 * Turns a validated Firebase token into our own principal, creating the user on first use (ADR 0004, rule 5).
 * This is the only place that reads the Jwt; everything downstream sees {@link AuthenticatedUser}.
 * <p>
 * Not a Spring bean on purpose: Spring MVC registers every Converter bean in its conversion service.
 */
class FirebaseJwtAuthenticationConverter implements Converter<Jwt, AbstractAuthenticationToken> {

	private final UserProvisioningService provisioningService;

	FirebaseJwtAuthenticationConverter(UserProvisioningService provisioningService) {
		this.provisioningService = provisioningService;
	}

	@Override
	public AbstractAuthenticationToken convert(Jwt jwt) {
		UUID userId = this.provisioningService.provision(AuthProvider.FIREBASE, jwt.getSubject());
		// Pre-authenticated: the identity was established by the provider and the token is already validated.
		// No authorities: authorization never comes from the token (ADR 0004, rule 2).
		return new PreAuthenticatedAuthenticationToken(new AuthenticatedUser(userId), null, List.of());
	}

}
