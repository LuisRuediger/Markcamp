# ADR 0001 — Tenancy model

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Luis

## Context

MarkCamp v1 used the simplest possible model: each marker belonged directly to a
user (`markers.user_id`), and Supabase RLS filtered by `auth.uid()`. That fits the
original use case: one person marking bait hives alone in the forest.

v2 is a learning project with an explicit premise of being ready for many users.
Before writing the first migration, we need to decide whether a marker is owned by
a person or by a project.

This decision is practically irreversible: changing it later requires a data
migration, a rewrite of the whole authorization layer and changes to the sync
protocol.

## Options considered

### A. Marker belongs to the user (`markers.user_id`)

- Simplest: one column, one `WHERE` clause.
- Trivial authorization that is hard to get wrong.
- Two devices of the same user can edit the same record, but real collaboration
  is out of reach.
- Moving to option B later requires a data backfill and an authorization rewrite.

### B. Marker belongs to a project; the project has members

- A `project_members` table links users to projects with a role.
- Authorization becomes role-based within a resource, not direct ownership.
- Opens the door to collaboration (e.g. a beekeepers' association sharing bait
  hives) without a future migration.
- Costs one extra table and one extra join from day one.

## Decision

**Option B**, with a single member per project at first.

Every project is created with its creator as `OWNER`. The UI exposes no sharing in
the first version. What we gain now is not the collaboration feature itself, but an
open door and a more interesting authorization problem to solve.

## Consequences

### Positive

- Collaboration becomes a product feature, not an architecture refactor.
- Role-based authorization is a real problem, with far more learning value than
  `WHERE user_id = ?`.
- The sync protocol is designed from the start assuming two different devices may
  touch the same record, which is the harder and more honest assumption.

### Negative

- Complexity carried from day one that may never be used.
- Every marker access goes through one extra join.
- Partially contradicts the principle of not building for scale that does not
  exist. The exception is justified only because this decision is irreversible;
  for everything else, the principle still applies.

### Derived rules (non-negotiable)

1. `created_by` is attribution and auditing, **never** authorization. Who can view
   or edit is defined exclusively by `project_members`.
2. No marker query may run without going through the project access check. The
   check lives in a single place in the application/repository layer, never
   scattered across controllers.
3. Initial roles: `OWNER` and `MEMBER`. Only two. Adding a third later is cheap;
   inventing five now is waste.
