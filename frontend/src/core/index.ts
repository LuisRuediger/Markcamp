// Layer rule (ADR 0007): core is pure TypeScript.
// It may import only other files in src/core/ and, in tests, vitest.
// No React, no npm package, no adapter, no ui, no browser API.
// Enforced by tsconfig.core.json (no DOM library) and by .oxlintrc.json.
