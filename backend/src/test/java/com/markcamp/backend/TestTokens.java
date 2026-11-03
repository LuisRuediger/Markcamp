package com.markcamp.backend;

import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.NoSuchAlgorithmException;
import java.security.interfaces.RSAPublicKey;
import java.time.Instant;
import java.util.Date;

import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;

import com.markcamp.backend.auth.FirebaseTokenValidators;
import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;

/**
 * Real signed tokens for tests, so no test calls Google.
 */
public final class TestTokens {

	// Must match src/test/resources/config/application.properties.
	private static final String PROJECT_ID = "markcamp-test";

	private static final KeyPair TRUSTED_KEY = generateRsaKeyPair();

	private static final KeyPair UNTRUSTED_KEY = generateRsaKeyPair();

	private TestTokens() {
	}

	/**
	 * Replaces the production decoder: same validators, but a key generated here instead of Google's.
	 */
	public static JwtDecoder jwtDecoder() {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withPublicKey((RSAPublicKey) TRUSTED_KEY.getPublic())
			.signatureAlgorithm(SignatureAlgorithm.RS256)
			.build();
		decoder.setJwtValidator(FirebaseTokenValidators.create(PROJECT_ID));
		return decoder;
	}

	public static String trusted(String subject) throws JOSEException {
		return signedToken(subject, TRUSTED_KEY);
	}

	public static String signedByUntrustedKey(String subject) throws JOSEException {
		return signedToken(subject, UNTRUSTED_KEY);
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
