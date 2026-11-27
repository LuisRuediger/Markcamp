import { describe, expect, it } from 'vitest'
import { isLandscapeTile, landscapeTileCache } from './tileCache.ts'

const matches = (href: string) => isLandscapeTile({ url: new URL(href) })

describe('isLandscapeTile', () => {
  it.each([
    'https://api.thunderforest.com/landscape/17/48123/75012@2x.png?apikey=k',
    'https://api.thunderforest.com/landscape/17/48123/75012.png?apikey=k',
  ])('accepts the Landscape tile %s', (href) => {
    expect(matches(href)).toBe(true)
  })

  it.each([
    { reason: 'another Thunderforest style', href: 'https://api.thunderforest.com/outdoors/17/1/1.png' },
    { reason: 'plain http', href: 'http://api.thunderforest.com/landscape/17/1/1.png' },
    { reason: 'a look-alike host', href: 'https://api.thunderforest.com.example.com/landscape/17/1/1.png' },
    { reason: 'another host, same path', href: 'https://example.com/landscape/17/1/1.png' },
    {
      reason: 'Esri satellite (ArcGIS basemaps)',
      href: 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/17/1/1',
    },
    {
      reason: 'Esri satellite (ArcGIS Online)',
      href: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/17/1/1',
    },
    { reason: 'OpenStreetMap', href: 'https://tile.openstreetmap.org/17/1/1.png' },
    { reason: 'the API on the preview', href: 'http://localhost:4173/api/projects' },
    { reason: 'the API on the tailnet', href: 'https://markcamp-dev.tailb53c35.ts.net/api/projects' },
  ])('refuses $reason: $href', ({ href }) => {
    expect(matches(href)).toBe(false)
  })
})

describe('landscapeTileCache', () => {
  it('is exactly the approved entry (slice F4-4a, V2/V3)', () => {
    // toStrictEqual: an extra key (maxAgeSeconds, networkTimeoutSeconds…) fails too.
    expect(landscapeTileCache).toStrictEqual({
      urlPattern: isLandscapeTile,
      // Offline is the point, and every network request spends the free plan's quota.
      handler: 'CacheFirst',
      options: {
        // A new name in a later build is the only way to renew kept tiles.
        cacheName: 'map-tiles-landscape-v1',
        // 200 only: 0 would keep opaque responses, which may be errors.
        cacheableResponse: { statuses: [200] },
        // A limit far below the quota keeps the tiles from competing with the queue; least
        // recently used go first. No maxAgeSeconds: Workbox 7.4.1 does not serve an expired
        // entry, so offline the tile would be gone.
        expiration: { maxEntries: 4000, purgeOnQuotaError: true },
      },
    })
  })
})
