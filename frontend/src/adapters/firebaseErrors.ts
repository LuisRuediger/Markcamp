import type { SignInErrorKind } from '../core/ports'

const KIND_BY_CODE: ReadonlyMap<string, SignInErrorKind> = new Map<string, SignInErrorKind>([
  // One kind on purpose: wrong email and wrong password are never told apart.
  ['auth/invalid-credential', 'invalidCredentials'],
  ['auth/wrong-password', 'invalidCredentials'],
  ['auth/user-not-found', 'invalidCredentials'],
  ['auth/invalid-email', 'invalidEmail'],
  ['auth/too-many-requests', 'tooManyAttempts'],
  ['auth/popup-closed-by-user', 'popupClosed'],
  ['auth/cancelled-popup-request', 'popupClosed'],
  ['auth/popup-blocked', 'popupBlocked'],
  ['auth/network-request-failed', 'network'],
])

// A Map, not an object: a code such as "constructor" must not find an inherited property.
export function signInErrorKindFromCode(code: string): SignInErrorKind {
  return KIND_BY_CODE.get(code) ?? 'unknown'
}
