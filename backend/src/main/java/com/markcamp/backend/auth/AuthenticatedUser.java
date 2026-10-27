package com.markcamp.backend.auth;

import java.util.UUID;

/**
 * The principal of every authenticated request: our internal user id, never the provider's sub (ADR 0004, rule 1).
 */
public record AuthenticatedUser(UUID id) {
}
