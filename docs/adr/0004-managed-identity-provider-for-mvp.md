# ADR 0004 — Use a managed identity provider for the MVP

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** Luis

## Context

ADR 0001 makes `project_members` the only source of authorization, and it needs a
`users` table to point to. Something has to establish who a user is: store
credentials, handle sign-up, sign-in, password reset and token issuing.

Constraints:

- Less than 2 hours per week of development time. Every session spent on identity
  infrastructure is a session not spent on bait hives.
- Security is a priority of the project. Credential storage is the area where a
  small mistake becomes a real vulnerability.
- Offline-first: beekeepers spend hours or days in the field without signal, so
  tokens will expire while the device is offline.
- Expected scale for the MVP: dozens to a few hundred users.

## Options considered

### A. Own authentication (Spring Security, password hashing, JWT issued by the backend)

- Full control and maximum learning on how identity works internally.
- The backend owns password storage, brute-force protection, email verification,
  password reset, token rotation and revocation. Each one is a place to get security
  wrong, and together they would take months of sessions before the first bait hive.

### B. Self-hosted identity provider (Keycloak in Docker Compose)

- Industry-standard OAuth2/OIDC, common in enterprise environments.
- No credential code in the backend.
- One more service to configure, secure, update, back up and keep running. Heavy on
  memory for a small deployment. Configuration alone would take several sessions.

### C. Managed identity provider (e.g. Firebase Authentication, Cognito, Clerk, Auth0)

- Free tiers cover the MVP many times over (tens of thousands of monthly users).
- Sign-up, sign-in, password reset and social login are provided.
- Users and credentials live with the vendor, outside Brazil. Pricing and free tiers
  can change without our input. Migrating away may require users to reset passwords.

## Decision

**Option C** for the MVP, with **Firebase Authentication** as the provider
(email/password and Google sign-in; no phone/SMS sign-in, which is billed per message).

The backend is an **OAuth2 Resource Server**: it only validates tokens and never
handles credentials. Identity (who you are) comes from the provider; authorization
(what you can do) stays in our database, per ADR 0001.

Firebase was chosen over the alternatives because its free tier is the largest
(50,000 monthly active users), it has first-party Angular support, and Google
sign-in removes the password step for most users.

## Consequences

### Positive

- No credential storage in our code, so the most dangerous class of auth bugs is
  out of our hands.
- Time goes to the domain instead of identity infrastructure.
- Token validation, issuer/audience checks and mapping an external identity to an
  internal user are still learned, and they are the parts every backend needs.

### Negative

- Vendor dependency for the most critical flow: if the provider is down, nobody can
  sign in (already signed-in devices keep working offline).
- Personal data (email, name) is processed by a third party abroad. Must be stated
  in the privacy policy before opening sign-ups to the public (LGPD).
- Less learning on how identity is issued internally.

### Derived rules (non-negotiable)

1. **We own the user.** The `users` table has its own UUID v7 primary key (ADR 0002).
   The provider's identifier is stored in `auth_provider` + `auth_subject` columns,
   unique together, and is **never** used as a primary or foreign key. Every other
   table references `users.id`. Changing providers means remapping these two columns,
   not migrating the database.
2. **Authorization never comes from the provider.** Roles and custom claims in the
   token are ignored. Access is decided only by `project_members` (ADR 0001).
3. **Every token is fully validated** before use: signature against the provider's
   published keys, algorithm, `iss`, `aud` (our project), `exp` and `iat`. A token
   that fails any check gets `401` with a generic message.
4. **Validation is local.** The backend verifies tokens with cached public keys and
   makes no call to the provider per request.
5. **Users are created on first authenticated request** (just-in-time provisioning),
   from the token's `sub` and the minimum profile data needed. No separate sign-up
   endpoint in our API.
6. **Tokens are never logged**, not even partially. Logs identify users by
   `users.id`, never by email.
7. **Offline never loses data.** The app works without a valid token. A token is only
   required to sync. If both the access token and the refresh token are no longer
   valid, the user signs in again and the pending sync queue is kept and sent after
   sign-in, never discarded.

### Revisit when

This is a decision for the MVP, not forever. Revisit it, and consider Keycloak
(option B), when one of these becomes true:

- Provider cost becomes relevant compared to revenue.
- A legal or customer requirement demands that identity data stay in Brazil or on
  our own infrastructure.
- A needed feature is missing from the provider.
- Learning to operate an identity provider becomes an explicit goal of the project.

Growth alone is not a reason: at higher scale a managed provider usually becomes
*more* valuable, because uptime and security patches stay with the vendor.
