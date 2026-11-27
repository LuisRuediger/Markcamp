import type { VitePWAOptions } from 'vite-plugin-pwa'

// The service worker's only runtime cache (ADR 0007 decision 4 and derived rule 4): map tile
// images of the street/terrain provider, Thunderforest Landscape, kept as the user views them
// (decision 10; derived rule 9: nothing is fetched ahead). API responses, the app's own origin,
// other Thunderforest styles and every other host (Esri satellite, OpenStreetMap) are never
// cached at runtime (derived rules 4 and 10).

/** One entry of workbox.runtimeCaching, taken from vite-plugin-pwa's own options type. */
type RuntimeCachingEntry = NonNullable<NonNullable<VitePWAOptions['workbox']>['runtimeCaching']>[number]

/**
 * Whether a request is a Thunderforest Landscape tile: exactly https://api.thunderforest.com,
 * path under /landscape/.
 *
 * Self-contained on purpose: workbox-build writes this function's source into sw.js
 * (matcher.toString()), without the rest of this module. Any constant, import or helper from
 * outside its body is copied as a bare name with no declaration in sw.js: the matcher throws a
 * ReferenceError on every request that reaches it, and no tile is ever kept. The tests cannot
 * see this (they run the module, not sw.js); check dist/sw.js after a build.
 */
export function isLandscapeTile({ url }: { url: URL }): boolean {
  return url.origin === 'https://api.thunderforest.com' && url.pathname.startsWith('/landscape/')
}

/**
 * Cache first: offline is the point, and every network request spends the free plan's monthly
 * quota. No maxAgeSeconds: in Workbox 7.4.1 an expired entry is not served, so offline in the
 * field an old tile would vanish. A kept tile never refreshes; renaming the cache (-v2) in a
 * later build renews them all.
 */
export const landscapeTileCache: RuntimeCachingEntry = {
  urlPattern: isLandscapeTile,
  handler: 'CacheFirst',
  options: {
    cacheName: 'map-tiles-landscape-v1',
    // Only real 200s. Never 0: an opaque response (a request without CORS) cannot be checked
    // and could be an error page kept for ever.
    cacheableResponse: { statuses: [200] },
    // maxEntries evicts the least recently used tiles, so the route being walked stays.
    // purgeOnQuotaError empties this cache when its own put hits the quota; it does not protect
    // the Dexie database, which is why the limit sits far below the quota.
    expiration: { maxEntries: 4000, purgeOnQuotaError: true },
  },
}
