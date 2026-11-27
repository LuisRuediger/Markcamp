// Compass arithmetic (decisions W3 and W8 of slice F4-5). Headings are degrees clockwise from
// north, in [0, 360).

/** Puts any angle in [0, 360). -0 and 360 both become 0. */
function normalise(deg: number): number {
  const wrapped = deg % 360
  const positive = wrapped < 0 ? wrapped + 360 : wrapped
  // A tiny negative wraps to 360 - ε, which floating point may round to 360 itself.
  return positive >= 360 || positive === 0 ? 0 : positive
}

/**
 * The heading from true (geographic) north, the map's. Declination is negative to the west:
 * with -16°, a magnetic 244° is a true 228°.
 */
export function trueHeading(magneticDeg: number, declinationDeg: number): number {
  return normalise(magneticDeg + declinationDeg)
}

/** The shortest angle between two headings, in [0, 180]: 359.5° and 0.2° are 0.7° apart. */
export function headingDelta(a: number, b: number): number {
  const difference = normalise(a - b)
  return difference > 180 ? 360 - difference : difference
}
