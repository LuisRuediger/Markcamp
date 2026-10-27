# ADR 0005 — Bait site history is an immutable event log

- **Status:** Accepted
- **Date:** 2026-10-27
- **Deciders:** Luis
- **Amends:** ADR 0003 (entity name only; the decision stands)

## Context

ADR 0003 made `bait` the core entity of the MVP and required a separate decision on
how bait history is modeled before the bait migration is written.

How baiting works in the field:

- A bait (a container with attractant) is installed at a site, usually a tree.
- It is inspected many times, may show bee activity, and may capture a swarm.
- Within about two months the captured colony either establishes or dies or absconds.
  Inspections continue throughout; a capture does not guarantee the colony will thrive.
- If the colony establishes, the bait is taken away with it and the colony is later
  transferred to a permanent box elsewhere.
- A site that captured once tends to attract swarms again and usually receives a new bait.
- Empty baits are sometimes moved from one site to another.
- Containers are not numbered or marked, and there is no need to locate a specific
  container or count its uses.

Requirements and constraints:

- History is the product. Users want capture rates per site, per season and per species,
  and to tell captures that established from captures that were lost. Losing past states
  is not acceptable.
- Offline-first: events are recorded in the field without signal and synced later,
  possibly out of order and from more than one device.
- Species are sometimes unknown at capture time. Some genera (e.g. *Scaptotrigona*)
  look alike at first and are identified weeks later.
- Common names vary by region; the same bee has several popular names.
- Less than 2 hours per week of development time.

## Options considered

### What the core entity represents

1. **The container.** History follows the container. A site's history is split across
   many containers with nothing linking them, and containers cannot be told apart in the
   field. Rejected.
2. **Site and container as separate entities**, linked by time-bounded installations.
   The most complete model of the field, but it needs a third, time-varying relation and
   an invariant ("a container is in one place at a time") that append-only offline events
   cannot guarantee. Every installation would ask the user to pick a container they cannot
   identify, and none of the required statistics need container identity. Rejected for
   the MVP; it can be added later without rewriting data (see Consequences).
3. **The site only; containers have no identity.** Chosen.

### How state is stored

- **A. Status column only.** Overwritten on each change; history is lost, which defeats
  the purpose of the product. Rejected.
- **B. Event log plus a stored `current_status` column.** Fast reads, but with offline
  sync events arrive out of order: the column must be recomputed by `occurred_at`, not by
  arrival order, and any code path that forgets this leaves it wrong. Rejected for the MVP
  for the same reason `updated_at` was left out of V1.
- **C. Event log only; status derived from events.** Slightly more complex queries, no
  derived data that can drift. Chosen.

### Event-specific data: typed columns vs. JSON

- Typed nullable columns with `CHECK` constraints: the database validates every row and
  queries are straightforward.
- A free-form `details jsonb` column: no migration for new fields, but the database
  accepts anything, and a typo in a key silently drops data from statistics.

With eight event types and one type-specific field (species), typed columns win.

## Decision

**The core entity is the bait site (table `bait_sites`), and its history is an
append-only table `bait_site_events` with typed columns.** `bait_sites` has no status
column.

### Naming

In the domain language, *isca* (bait) is the container and *ponto* is the place. The
entity is named *bait site* so the code uses words the way users do. This refines the
naming in ADR 0003; its decision (a specific domain entity, no generic marker) stands.

### Cycles

- A cycle starts with `INSTALLED` and ends with `COLLECTED`, `REMOVED`, or the next
  `INSTALLED` (re-arming after a lost colony).
- A site has at most one open cycle. Two baits on the same tree are two sites.
- The cycle an event belongs to is derived: the latest non-voided `INSTALLED` at or
  before it. There is no `cycle_id` column.
- Sites are not deactivated in the MVP. A site without a bait has status `EMPTY`.
- Moving an empty bait from site A to site B is `REMOVED` at A plus `INSTALLED` at B. The
  UI may offer this as a single "move" action; the model does not change.

### Event types and statuses

| Event | Meaning | Status after |
|---|---|---|
| `INSTALLED` | Bait placed at the site; opens a cycle | `ARMED` |
| `ACTIVITY` | Bee activity, no swarm yet | `ACTIVE` |
| `CAPTURED` | A swarm moved in | `CAPTURED` |
| `LOST` | The colony died or absconded; the bait is still in place | `LOST` |
| `COLLECTED` | Bait taken away with its colony; closes the cycle | `EMPTY` |
| `REMOVED` | Bait taken away without a colony; closes the cycle | `EMPTY` |
| `INSPECTED` | A visit or inspection | unchanged |
| `IDENTIFIED` | Assigns or corrects the species of an earlier capture | unchanged |

Allowed transitions:

| Event | Allowed when the status is |
|---|---|
| `INSTALLED` | none (first event of the site), `EMPTY`, `LOST` |
| `ACTIVITY` | `ARMED`, `ACTIVE` |
| `CAPTURED` | `ARMED`, `ACTIVE`, `LOST` |
| `LOST` | `CAPTURED` |
| `COLLECTED` | `CAPTURED` |
| `REMOVED` | `ARMED`, `ACTIVE`, `LOST` |
| `INSPECTED` | any except `EMPTY` |
| `IDENTIFIED` | any, provided it occurs after the capture it identifies |

`CAPTURED` from `LOST` covers a new swarm occupying a bait whose colony died, without
re-arming.

### Species

- A reference table `species`, global (not per project), seeded by Flyway migrations.
- Identity is the scientific name (`scientific_name`, unique). `common_name` is the
  display name in the UI. Genus-level entries are allowed (e.g. `Scaptotrigona sp.`).
- Events reference species by id, never by name, so names can change and regional
  synonyms can be added later without touching history.
- The list holds the species most commonly captured in baits. Adding a species is a
  new migration.
- When a user's species is missing, the capture is recorded as unidentified and the UI
  points to an external contact channel to suggest it. Once the species is added, an
  `IDENTIFIED` event completes the record. An in-app suggestion workflow is out of the
  MVP scope.

## Consequences

### Positive

- Full history is preserved and trustworthy; statistics are computed from facts.
- A site's history is continuous across cycles, which is what capture statistics need.
- Append-only events do not conflict during offline sync: two devices only add rows.
- Constraints live in the database where possible.
- A missing species never blocks recording a capture in the field.
- Container identity can be added later with an additive migration: a `baits` table and a
  nullable `bait_id` on `INSTALLED` events. Past events stay valid without it. A bait
  *type* (e.g. PET bottle vs. bait box) does not need container identity and can be a
  column on `INSTALLED` events when needed.

### Negative

- Reading the current status of many sites needs a "latest event per site" query.
  Accepted: with an index on `(bait_site_id, occurred_at DESC)` this is cheap at the
  expected scale. A stored column or materialized view can be added when a measured
  query is slow.
- Mistakes cannot be edited away; correcting one takes two steps (void + new event), and
  voiding an event that later events depend on requires voiding those first.
- Sequence validation replays a site's history on every insert and void. Accepted: a site
  has tens of events, not thousands.
- An event recorded offline can be rejected at sync time if another device recorded an
  earlier event that makes the sequence invalid. Handling this is part of the offline
  sync decision, which is still open.
- Adding a species requires a migration and a deploy. Accepted while the list is small
  and curated.

### Derived rules (non-negotiable)

1. **Immutability.** Events are never updated or deleted. The only allowed change is
   voiding: setting `voided_at` and `voided_by` once. A voided event is ignored by every
   status, validation and statistics calculation. Voiding cannot be undone.
2. **Two timestamps.** `occurred_at` is when it happened in the field, sent by the
   client. `recorded_at` is set by the server when the row is stored. `occurred_at`
   must not be in the future beyond a small clock tolerance (configurable, initially
   10 minutes).
3. **Status is derived** from the latest non-voided state-changing event by
   `occurred_at`, with `id` (UUID v7) as tie-breaker, using the status table above.
4. **Species columns.**
   - `species_id` may be set only on `CAPTURED` (optional: null means unidentified) and
     `IDENTIFIED` (required).
   - `identified_event_id` is required on `IDENTIFIED` and forbidden on every other type.
   - A composite foreign key `(bait_site_id, identified_event_id)` →
     `bait_site_events (bait_site_id, id)` guarantees in the database that the identified
     capture belongs to the same site. That the target is a non-voided `CAPTURED` event
     is checked in the application.
   - The species of a capture is the one from its latest non-voided `IDENTIFIED` event;
     if there is none, the capture's own `species_id`; otherwise it is unidentified.
5. **Sequence validation**, in a single place in the application:
   - A bait site and its first `INSTALLED` event are created in the same transaction.
   - Every insert and every void replays the site's non-voided events, ordered by
     `(occurred_at, id)`, through the transition table above. If any transition is not
     allowed, the operation is rejected.
   - `IDENTIFIED` must occur after the capture it identifies, and that capture must be a
     non-voided `CAPTURED` event.
6. **ADR 0001 and 0002 apply.** A bait site belongs to a project, and every query on
   `bait_sites`, `bait_site_events` and their data goes through the project access check.
   All three tables use UUID v7 primary keys; species seeded by migration use fixed
   UUID v7 literals.
7. **Future colonies** (out of MVP scope) will reference their origin `CAPTURED` event
   through `origin_event_id`. Transfer to a permanent box belongs to the colony's history,
   not the site's, so there is no `TRANSFERRED` event.
