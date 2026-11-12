import type { GeoReading } from './ports'

// What the New site screen does with GPS readings (decision J3 of slice F3). The adapter
// passes readings through as the device reports them; deciding which ones count is here.

/**
 * Finite coordinates within range and a finite accuracy > 0 (the server refuses accuracy <= 0:
 * CreateBaitSiteRequest). Written so that NaN fails: every comparison with NaN is false.
 */
export function isUsableReading(reading: GeoReading): boolean {
  const { latitude, longitude, accuracyM } = reading
  return (
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    // Infinity > 0 is true, so it is rejected by name, like the server does.
    Number.isFinite(accuracyM) &&
    accuracyM > 0
  )
}

/** The reading with the smaller accuracyM; ties keep `best`. Unusable `next` → `best` unchanged. */
export function betterReading(best: GeoReading | null, next: GeoReading): GeoReading | null {
  if (!isUsableReading(next)) return best
  if (best === null || next.accuracyM < best.accuracyM) return next
  return best
}
