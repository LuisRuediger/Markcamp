import { expect, test } from 'vitest'
import { signInErrorKindFromCode } from './firebaseErrors'

test.each([
  ['auth/invalid-credential', 'invalidCredentials'],
  ['auth/wrong-password', 'invalidCredentials'],
  ['auth/user-not-found', 'invalidCredentials'],
  ['auth/invalid-email', 'invalidEmail'],
  ['auth/too-many-requests', 'tooManyAttempts'],
  ['auth/popup-closed-by-user', 'popupClosed'],
  ['auth/cancelled-popup-request', 'popupClosed'],
  ['auth/popup-blocked', 'popupBlocked'],
  ['auth/network-request-failed', 'network'],
  ['auth/some-new-code', 'unknown'],
  ['constructor', 'unknown'],
])('%s maps to %s', (code, kind) => {
  expect(signInErrorKindFromCode(code)).toBe(kind)
})
