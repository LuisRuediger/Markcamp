// The default import on purpose, not `import { model }`: the package is CommonJS and builds
// module.exports through an alias (`const geomagnetism = module.exports = {}`), which Node's
// own named-export detection does not see ("Named export 'model' not found"). The named form
// happens to work in the Vite build, in tsc and in Vitest (their CommonJS interop; mutation (k)
// of slice F4-5), but the default import works everywhere, Node included, without relying on
// it. The only file that imports geomagnetism (enforced in .oxlintrc.json).
import geomagnetism from 'geomagnetism'

/**
 * The magnetic declination at a point, in degrees, negative to the west (about -20° in
 * Blumenau in 2026), from the World Magnetic Model bundled in the package (decision W3 of
 * slice F4-5). Computed on the device: no network.
 *
 * allowOutOfBoundsModel: without it the package throws for any date past the last model's
 * end (WMM2025: 2029-11-13), and the compass would stop. With it, the model is extrapolated,
 * slowly drifting, and the package writes "Model is only valid from …" (the model's dates,
 * nothing about the place) to console.error on every call: the reminder to update it.
 */
export function declinationDeg(latitude: number, longitude: number, date: Date): number {
  return geomagnetism.model(date, { allowOutOfBoundsModel: true }).point([latitude, longitude]).decl
}
