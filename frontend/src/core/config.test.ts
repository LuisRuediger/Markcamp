import { expect, test } from 'vitest'
import { parseFirebaseConfig } from './config'

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
