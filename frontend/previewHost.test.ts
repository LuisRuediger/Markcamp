import { describe, expect, it } from 'vitest'
import { previewAllowedHosts } from './previewHost.ts'

describe('previewAllowedHosts', () => {
  it.each([
    { label: 'unset', value: undefined, expected: [] },
    { label: 'empty', value: '', expected: [] },
  ])('returns no extra host when $label', ({ value, expected }) => {
    expect(previewAllowedHosts(value)).toEqual(expected)
  })

  it.each([
    { value: 'markcamp-dev.tailb53c35.ts.net', expected: ['markcamp-dev.tailb53c35.ts.net'] },
    { value: 'a.b', expected: ['a.b'] },
  ])('accepts the host name $value', ({ value, expected }) => {
    expect(previewAllowedHosts(value)).toEqual(expected)
  })

  it.each([
    { reason: 'leading dot (every subdomain)', value: '.ts.net' },
    { reason: 'scheme', value: 'https://markcamp-dev.tailb53c35.ts.net' },
    { reason: 'trailing slash', value: 'markcamp-dev.tailb53c35.ts.net/' },
    { reason: 'port', value: 'markcamp-dev.tailb53c35.ts.net:4173' },
    { reason: 'leading space', value: ' markcamp-dev.tailb53c35.ts.net' },
    { reason: 'trailing space', value: 'markcamp-dev.tailb53c35.ts.net ' },
    { reason: 'uppercase', value: 'Markcamp-dev.tailb53c35.ts.net' },
    { reason: 'no dot', value: 'localhost' },
    { reason: 'label starting with a hyphen', value: '-a.b' },
    { reason: 'label ending with a hyphen', value: 'a-.b' },
    { reason: 'empty label', value: 'a..b' },
    { reason: 'trailing dot', value: 'a.b.' },
    { reason: 'inner space', value: 'a b.c' },
  ])('rejects $reason: "$value"', ({ value }) => {
    expect(() => previewAllowedHosts(value)).toThrow(Error)
    expect(() => previewAllowedHosts(value)).toThrow(/MARKCAMP_PREVIEW_HOST/)
  })
})
