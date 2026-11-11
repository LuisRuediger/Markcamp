import { initializeApp } from 'firebase/app'
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import type { FirebaseConfig } from '../core/config'
import { SignInError, type AuthPort } from '../core/ports'
import { signInErrorKindFromCode } from './firebaseErrors'
import { withTimeout } from './withTimeout'

/** The same limit as a request (ADR 0008, decision 5). */
const TOKEN_TIMEOUT_MS = 20_000

function toSignInError(error: unknown): SignInError {
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'none'
  const kind = signInErrorKindFromCode(code)
  if (kind === 'unknown') {
    // Only the code: a Firebase error carries customData, which may include the email.
    console.warn(`Unmapped Firebase auth error code: ${code}`)
  }
  return new SignInError(kind)
}

export function createFirebaseAuth(config: FirebaseConfig): AuthPort {
  const app = initializeApp(config)
  // initializeAuth, not getAuth: keeping the session on the device is a decision (a person
  // opening the app in the field must stay signed in), so it is stated here, not a default.
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  })
  auth.languageCode = 'pt-BR'

  return {
    onUserChanged(listener) {
      return onAuthStateChanged(auth, (user) => {
        listener(user === null ? null : { email: user.email })
      })
    },
    async signInWithEmail(email, password) {
      try {
        await signInWithEmailAndPassword(auth, email, password)
      } catch (error) {
        throw toSignInError(error)
      }
    },
    async signInWithGoogle() {
      try {
        // Popup, not redirect: redirect breaks in browsers that block third-party storage
        // unless /__/auth is reverse-proxied, which belongs to the deployment.
        await signInWithPopup(auth, new GoogleAuthProvider())
      } catch (error) {
        throw toSignInError(error)
      }
    },
    signOut() {
      return signOut(auth)
    },
    async getIdToken(forceRefresh) {
      const user = auth.currentUser
      if (user === null) throw new Error('No signed-in user.')
      // On weak signal a refresh may never settle, and the single-flight sync engine would
      // wait on it until the app restarts. A rejection becomes 'unavailable' in the API client.
      return withTimeout(user.getIdToken(forceRefresh), TOKEN_TIMEOUT_MS)
    },
  }
}
