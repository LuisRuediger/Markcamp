# ADR 0007 — Frontend is a local-first React PWA with a framework-free core

- **Status:** Accepted
- **Date:** 2026-11-07
- **Deciders:** Luis
- **Amended:** 2026-11-24 (map session: tile provider, map tiles cached as the user views them, satellite online only, compass without map rotation, Leaflet without a React wrapper)
- **Amended:** 2026-11-27 (compass: true north from the World Magnetic Model; portrait only)

## Context

The backend for the bait hive MVP is complete (auth, projects, bait sites, events,
species, derived status, voiding). The next step is a client.

Constraints:

- Less than 2 hours per week of development time. Sessions spent on tooling are
  sessions not spent on the product or on the architecture this project exists to
  teach (offline, sync, security).
- Bait sites are in the field, often without cellular signal for hours. A bait site
  or event recorded offline exists only on the device until it syncs. The sync
  protocol itself is still open (decided in its own session).
- The developer uses Angular at work and has used React and Next.js in freelance
  work. React is more common in the remote job market he is aiming at.
- The product may need to be in the Play Store and the App Store later, but nothing
  concrete requires it today: the first user is the developer, and distribution
  starts with a link in beekeeping groups.
- The backend API is client-agnostic (ADR 0006: clients decide by `code`, never by
  English text).

## Options considered

### Framework

- **Angular.** Batteries included (HTTP interceptors, DI, router guards, official
  service worker). Same stack as the developer's job.
- **React + Vite (SPA).** Known to the developer, larger ecosystem and job market.
  Fewer built-ins: routing, HTTP and state are separate choices.
- **Next.js.** Strong at server rendering and SEO. An app behind a login, built to
  work offline, uses neither, and server rendering complicates a PWA.
- **React Native (Expo).** Truly native: SQLite that the OS does not evict,
  background location, offline map packs, store presence. A different ecosystem
  (navigation, styling, native builds, device testing), store accounts, review on
  every release, store commission on in-app subscriptions, and a weaker web/desktop
  experience. All of that cost is paid before anyone needs a store.

### Delivery

- **PWA only, forever.** Cheapest, but some limits are real on iOS (storage may be
  evicted for sites that are not installed; push only for installed apps).
- **PWA now, wrapped later.** The same web app can go to the Play Store as a Trusted
  Web Activity, or to both stores through Capacitor (native shell with plugins for
  SQLite, background location and push). No rewrite.
- **Native from day one.** See React Native above.

### Where the UI reads data from

- **Directly from the API (online-first, HTTP cache for offline).** Every screen
  would have to merge "what the server returned" with "what is still in the outbox".
  An HTTP cache stores responses; it knows nothing about a bait site created offline.
- **From a local database, with a separate sync engine (local-first).** The UI has
  one source. Online and offline are the same code path.

### Local storage

- **localStorage.** Synchronous, strings only, a few MB, no transactions.
- **Raw IndexedDB.** Verbose event-based API, schema upgrades by hand.
- **`idb`.** Thin promise wrapper; schema migrations still by hand.
- **Dexie.** Versioned schema with upgrade functions (the device-side equivalent of
  Flyway: users who already have data must not lose it), transactions, and reactive
  queries (`useLiveQuery`) that re-render when data changes, including when the sync
  engine writes.

## Decision

1. **The frontend is a React single-page app built with Vite, in TypeScript (strict),
   delivered as a PWA.** No server rendering.
2. **The stores are reached later by wrapping the same app** (Capacitor for both
   stores, or a Trusted Web Activity for Android), only when there is a concrete
   need: a user asking for it, data loss on iOS, or a feature that needs native
   capabilities (e.g. background location). React Native is not adopted now.
3. **The UI is local-first.** Screens read and write only the local database
   (IndexedDB through Dexie). A sync engine is the only code that sends domain data
   to the API or brings it back. The derived status of a bait site is computed on the
   device by the TypeScript state machine, tested against
   `shared/bait-site-state-machine-cases.json` (already decided in the events slice).
   No server-state cache library (TanStack Query) and no global store (Redux): the
   local database is the state.
4. **The service worker precaches the app shell only** (HTML, JS, CSS, fonts, icons).
   It never caches API responses. Domain data lives in exactly one place on the device.
   *Amendment (map session):* one runtime cache exists, for **map tile images from the
   configured street/terrain tile provider only**, filled as the user views the map
   (see decision 10). Tiles are a background picture, not domain data, so the
   "one place" rule is untouched.
5. **The code is split into three layers, enforced by tooling:**
   - `src/core/` — pure TypeScript: domain rules, state machine, sync logic, types,
     and the interfaces (ports) for storage, transport and auth. It is compiled with
     a TypeScript configuration **without the DOM library** and may not import React
     or any adapter, so using `window`, `document`, `fetch` or `indexedDB` there is a
     compile error.
   - `src/adapters/` — implementations of the core's interfaces (Dexie, `fetch`,
     Firebase). May import `core`, never `ui`.
   - `src/ui/` — React. May import `core`, never `adapters`. Adapters are wired in a
     single composition root (`src/main.tsx`).
   Moving to Capacitor then means swapping the storage adapter (e.g. to SQLite);
   moving to React Native means rewriting `ui` only. The expensive part (rules, sync,
   tests) moves unchanged.
6. **Authentication uses the modular Firebase JS SDK directly**, behind an adapter
   (no AngularFire/reactfire-style wrapper). The HTTP client is a thin wrapper over
   `fetch` (no axios) that attaches `Authorization: Bearer` **only** to requests whose
   URL starts with the configured API base. Tokens never go to third parties (e.g. a
   map tile server).
7. **Outbox entries belong to the user who created them.** The sync engine sends only
   entries owned by the signed-in user. ADR 0004 still holds (the outbox is never
   discarded on re-login), but if another person signs in on the same device, the
   first user's events are never sent with the second user's token.
8. **No CORS in the backend for now.** In development the Vite dev server proxies
   `/api` to the backend, so the browser sees a single origin. In production, same
   origin is preferred (a reverse proxy serving the frontend and `/api`); if that is
   not possible, an explicit allowlist from configuration, never `*`. Decided with the
   deployment.
9. **The Firebase web configuration (including the Web API key) lives in the
   frontend build.** It identifies the project and is not a secret; it is protected by
   restricting the key by HTTP referrer in Google Cloud and by Firebase's authorized
   domains. It never goes into the backend `.env`.
10. **The map uses Leaflet, north up, driven directly from React** (one component owns
    the map instance; no React wrapper such as react-leaflet). The map never rotates;
    the compass is a control that turns with the device and marks east (bait entrances
    face sunrise), so Leaflet needs no rotation plugin. *Amendment (map session):*
    - **Street/terrain layer: Thunderforest "Landscape"** (free plan, API key in the
      frontend build, not a secret). Its terms allow keeping tiles on the device for
      offline use, beyond their HTTP expiry; they forbid pre-downloading an area on the
      free plan. So tiles are cached **only as the user views them**; there is no
      "download this area" feature. Preparing a route = viewing it once with a
      connection.
    - **Satellite layer: Esri World Imagery, online only, during the testing phase**
      (non-commercial use, free ArcGIS account). Its tiles are never cached. It must be
      replaced before the app is sold.
    - Tiles from the public OpenStreetMap servers are never used for offline (their
      usage policy forbids offline use and prefetching).
    - Attribution required by each provider is always visible on the map.
    - **The bait site list, sorted by distance from the current GPS position, must work
      without the map**, because offline the map may have no background for areas
      never viewed.
    - *Amendment (compass, slice F4-5):* **the compass and the heading cone use true
      north**, the map's. iOS Safari's `webkitCompassHeading` is magnetic (measured on
      the device, 2026-11-27); the app adds the magnetic declination at the map's
      centre, computed on the device with the World Magnetic Model through the
      `geomagnetism` package (WMM2025, valid until 2029-11-13: update the package
      before then; past it, the model is extrapolated). **They work only in portrait**:
      Safari reports the heading of the device's top edge and gives no usable screen
      angle, and the screen cannot be locked to portrait in iOS Safari.
    Revisit when the app is sold (both providers' plans and terms), or when "download
    this area" is needed (paid plan, or self-hosted OpenStreetMap vector tiles).
11. **The app requests persistent storage** (`navigator.storage.persist()`) and
    encourages installation to the home screen, because the outbox is the one thing
    that must not disappear.

## Consequences

### Positive

- Online and offline share one code path; the outbox and the screens never disagree.
- The framework-free core keeps every future move (Capacitor, React Native, another
  UI framework) cheap, and the rule is checked by the compiler and the linter, not by
  memory.
- Distribution is a link and an update is a deploy, with no store review, while the
  product has a handful of users.
- No backend change: the API was already client-agnostic.

### Negative

- iOS limits remain until the app is wrapped: storage of a non-installed site may be
  evicted, push needs installation, no background location.
- The state machine exists in Java and in TypeScript. Mitigated by the shared cases
  file that both test suites must pass.
- A local-first client needs a sync engine before it is useful offline; until the
  sync session, the first slices are online-only.
- Fewer built-ins than Angular: each extra need (routing, forms) is a dependency to
  justify.
- Offline, the map has a background only where the user has looked before, at the
  zoom levels looked at. Areas never viewed show markers and position on a blank
  background.
- Both tile providers are chosen for the testing phase; selling the app means
  revisiting their plans and terms.

## Derived rules (non-negotiable)

1. Screens never call the API. They read and write the local database (or, before the
   local database exists, a store in `core` that hides where data comes from).
2. Nothing in `src/core/` imports React, an adapter, or a browser API. The core
   TypeScript configuration has no DOM library.
3. `src/ui/` never imports from `src/adapters/`; `src/main.tsx` is the only place that
   wires them.
4. The service worker has no runtime caching rule for `/api`. Its only runtime cache
   is for tile images of the street/terrain provider's host (cache first, entry limit,
   purged on quota error); no other host is cached at runtime.
5. The bearer token is attached only to the configured API base URL.
6. Outbox entries carry their owner; only the signed-in owner's entries are sent.
7. No CORS configuration in the backend until a deployment needs a second origin, and
   never a wildcard.
8. Ordering of events is never re-implemented differently on the device: the device
   orders by `(occurred_at, id)` with the same comparison as the server (UUIDs as
   unsigned bytes, i.e. their canonical lowercase string), and the shared cases file
   is the contract.
9. Map tiles are never fetched ahead of what the user is viewing (no prefetch, no
   bulk download), whatever the provider.
10. Satellite tiles are never stored on the device.
11. The bearer token never goes to a tile host (rule 5 already covers it: tiles are
    requested by Leaflet, never through the API client).
