# ADR 0008 — Offline sync for the MVP: upload queue, project snapshot download

- **Status:** Accepted
- **Date:** 2026-11-10
- **Deciders:** Luis

## Context

ADR 0007 made the frontend local-first: screens read only from the local database, a single sync engine talks to the API, the queue is per user, and the client generates UUID v7 ids that are reused on every retry (`409 ID_ALREADY_EXISTS` → `GET`, the server's version wins). ADR 0007 chose Dexie (IndexedDB) but left the sync protocol open.

Facts that shaped this decision:

- **MVP usage:** one user (the owner of the project), always on a phone, never on a computer. Multi-user and multi-device are not MVP requirements; the data model (projects with members, ADR 0001) does not change.
- The phone is often in the field with weak or no signal. A PWA does not run reliably when closed.
- The API at `df0fb18` has: projects (list, create, get), bait sites per project (list, create, get), events per bait site (list non-voided, create, get, void), species, `/api/me`. There is no changes feed, no batch endpoint, no project-wide event list, and no endpoint to correct a bait site's name/location.
- Today the user has ~30 bait sites; growth to ~300 is plausible.
- Mobile browsers may evict site storage. Confirmed data can be downloaded again; only the not-yet-uploaded queue would be lost.

## Options considered

**Retry trigger**
1. Only the browser `online` event. Rejected: it reports a connected network interface, not working internet. Weak signal, server down (5xx) and a token that could not refresh never fire it again, so the queue would stall until the app is reopened.
2. Exponential backoff with a cap. Rejected for the MVP: it protects the server from many clients reconnecting at once, which does not happen with one user. Kept as the path when there are many users (with jitter).
3. **Event triggers plus a fixed 1-minute safety timer while the queue is not empty, plus a per-request timeout.** Chosen.

**Download**
1. Snapshot with 1 + N requests (bait sites, then events per site). Rejected: does not scale (300 sites ≈ 302 requests over 4G).
2. Delta sync (changes since a cursor). Rejected for the MVP: voiding changes a row and bait site name/location will change, so it needs change detection (`updated_at` or a sequence, deliberately postponed), a cursor and more tests; the gain only shows with thousands of sites.
3. **Project snapshot in 3 requests, with a new `GET /api/projects/{projectId}/events`.** Chosen.

**Where pending changes live**
1. Pending rows written to the local tables *and* to the queue in one transaction, rows flagged "pending". Rejected: the snapshot replaces the local copy, so it would have to skip flagged rows; two sources of truth that must always agree.
2. **Pending changes live only in the queue; local tables are exactly what the server confirmed.** Chosen.

**Owner key and isolation**
1. One database with an `ownerId` column on every table. Rejected: every query must filter; a forgotten filter mixes accounts.
2. Firebase `uid` as the key. Rejected: ties the device data to the auth provider, which ADR 0004 allows replacing.
3. **One IndexedDB database per user, named by the internal user id.** Chosen.

**How the UI reaches Dexie**
1. `useLiveQuery` in the UI. Rejected: the UI would import `dexie`, breaking ADR 0007 derived rule 3.
2. A generic database port (tables, transactions). Rejected: transactions would be in the core's hands, so they could be done wrong.
3. **A core port with domain operations, implemented by a Dexie adapter.** Chosen.

**Which bait site an event belongs to, in API responses**
1. Only in the project-wide list, as a separate response type. Rejected: the client would need two event parsers, and the response of a create or void (which decision 3 writes into the local copy) would not say which site the event belongs to.
2. **`baitSiteId` in every event response.** Additive; no client read event responses when it was added. Chosen.

## Decision

1. **Upload queue.** Create project, create bait site, record event and void event go through the queue. Events (and voids) of the same bait site are sent one at a time, in recording order, waiting for each response (ADR 0007).
2. **Pending changes live only in the queue.** A queue item holds the full payload. Local tables for projects, bait sites and events are exactly the server-confirmed copy. The UI merges confirmed + pending in a pure core function (including bait sites created offline, which exist only in the queue) and runs the state machine `replay` over the result.
3. **Confirmation is atomic.** When the server confirms an item, one IndexedDB transaction removes it from the queue and writes the server's response into the local copy.
4. **One thing at a time.** The sync engine uploads everything first, then downloads. Upload and download never run concurrently, so a snapshot that started before a confirmation can never land after it.
5. **Retry.** Network failure, 5xx and token unavailable are retried without limit (nothing is discarded silently). Triggers: `online` event, app open, a "sync now" button, a new item entering the queue. Safety net: a fixed 1-minute timer while the app is open and the queue is not empty (no timer when it is empty). Every request has a timeout (~20 s) so a hanging request on weak signal cannot block the queue. No sending while the app is closed (Background Sync is out of the MVP).
6. **Sequence is checked on the device first.** Before recording an event the app runs `replay` and refuses impossible sequences. A `409 INVALID_EVENT_SEQUENCE` from the server is then treated as a bug: it blocks the queue for that bait site only (others continue) and is shown with "retry" and "discard"; no automatic retry.
7. **Download = project snapshot.** After trying to empty the queue, the app downloads bait sites, events and species in 3 requests and replaces the local copy entirely. The queue is never touched by the download. It runs on app open and on the button. A void made elsewhere arrives for free (the event disappears from the list).
8. **New endpoint:** `GET /api/projects/{projectId}/events` returns all non-voided events of the project in `{ "items": [...] }`, member-only (`404` for non-members, `200` with an empty list for a project with no events), ordered by `(occurred_at, id)` like the per-site list, so the events of any one site appear in history order. Every event response (this list, the per-site list, get, record, void) carries `baitSiteId`. Estimate at 300 sites × ~20 events: ~1 MB JSON, ~150 KB compressed.
9. **One database per user.** IndexedDB database `markcamp-<internal user id>` (from `/api/me`); no owner column anywhere. A small separate database maps Firebase `uid` → internal id so the right database opens offline (Firebase restores the session without network, `/api/me` does not); first login is always online, so the mapping exists when needed. The `uid` stays on the device and is never logged. Logout closes the database without deleting it.
10. **Dexie behind a core port with domain operations:** an observable read ("observe project X" → `subscribe`/`getSnapshot` with confirmed + pending, consumed with `useSyncExternalStore`; `liveQuery` inside the adapter) and named writes ("enqueue", "confirm item" = decision 3 in one method, "replace project copy with snapshot", "next queue items"). Only the adapter imports `dexie`. This clarifies ADR 0007: the decision there is "Dexie", not its React hook; ADR 0007 is not amended.
11. **Storage persistence.** Using the app installed on the home screen is a condition of use for the MVP (it is what protects storage on both Android and iOS). On app open, signed in, if storage is not yet persisted, call `navigator.storage.persist()` once, with no custom dialog; the result never blocks anything and is logged as a fixed phrase. When the app runs in a browser tab (not installed), show a banner asking to install it so unsent records are not lost.

## Consequences

- The protocol is simple and correct for one user: no cursors, no conflict resolution, no change detection on the server.
- Reinstalling the app, a new phone or cleared site data are recovered by the snapshot; only items still in the queue can be lost, and only if storage is evicted.
- Records made with the app closed are not sent until the app is opened again with signal.
- The merge of confirmed + pending is a core function with its own tests; it must cover bait sites that exist only in the queue.
- Reads start in a "loading" state (IndexedDB is asynchronous); the UI handles it like the session's loading state.
- New dev dependency `fake-indexeddb`, so the Dexie adapter (and its transaction) is tested in Vitest; Node has no IndexedDB.
- The projects screen, which reads projects straight from the API, moves to the local database.
- The project-wide event list needs no new index: it joins `bait_sites` by `project_id` and `bait_site_events` by `bait_site_id`, both indexed since V2. Revisit when a measured snapshot is slow.
- Dev caveat: recreating the Docker database gives the same `uid` a new internal id; the old local database is left behind (clear site data on the test phone).
- **Reopen triggers:** snapshot measured above a few MB or slow → delta sync or pagination; many users → exponential backoff with jitter; a second client or separate front-end deploy → API versioning; name/location correction endpoint → last-write-wins decision for two devices; real need → batch endpoint, Background Sync, content comparison on `409 ID_ALREADY_EXISTS`.

## Derived rules

1. A screen never reads pending data from anywhere but the merge of confirmed copy + queue.
2. Nothing outside the confirm operation removes a queue item, except an explicit user "discard".
3. The download only ever writes the confirmed copy; it never reads or writes the queue.
4. Upload and download are never in flight at the same time.
5. Every sync request has a timeout.
6. Only the Dexie adapter imports `dexie`; the UI never does.
7. No table in the per-user database has an owner column; isolation comes from opening the user's database.
8. The Firebase `uid` is stored only in the mapping database and never appears in logs.
