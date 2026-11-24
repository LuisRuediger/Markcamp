import { describe, expect, test } from 'vitest'
import { parseFirebaseConfig, parseMapConfig } from './config'

test('all variables present gives the config', () => {
  const result = parseFirebaseConfig({
    VITE_FIREBASE_API_KEY: 'key',
    VITE_FIREBASE_AUTH_DOMAIN: 'domain',
    VITE_FIREBASE_PROJECT_ID: 'project',
    VITE_FIREBASE_APP_ID: 'app',
  })

  expect(result).toEqual({
    ok: true,
    config: { apiKey: 'key', authDomain: 'domain', projectId: 'project', appId: 'app' },
  })
})

test('one missing and one blank are both listed by name', () => {
  const result = parseFirebaseConfig({
    VITE_FIREBASE_API_KEY: undefined,
    VITE_FIREBASE_AUTH_DOMAIN: '   ',
    VITE_FIREBASE_PROJECT_ID: 'project',
    VITE_FIREBASE_APP_ID: 'app',
  })

  expect(result).toEqual({
    ok: false,
    missing: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN'],
  })
})

describe('parseMapConfig', () => {
  test.each([
    ['absent', undefined],
    ['blank', ''],
    ['only spaces', '   '],
  ])('%s key is listed by name', (_name, value) => {
    expect(parseMapConfig({ VITE_THUNDERFOREST_API_KEY: value })).toEqual({
      ok: false,
      missing: ['VITE_THUNDERFOREST_API_KEY'],
    })
  })

  test('a key gives the config, trimmed', () => {
    expect(parseMapConfig({ VITE_THUNDERFOREST_API_KEY: '  abc123 ' })).toEqual({
      ok: true,
      config: { tileApiKey: 'abc123' },
    })
  })
})
