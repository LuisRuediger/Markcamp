// Layer rule (ADR 0007): adapters implement the interfaces declared by core.
// They may import core and never ui. They are wired only in src/main.tsx.
// Enforced by .oxlintrc.json.
