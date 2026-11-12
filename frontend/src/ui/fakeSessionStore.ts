import { vi } from 'vitest'
import type { SessionIdentitySource, SessionSnapshot, SessionStore } from '../core/sessionStore'

// Test helper. A fixed snapshot: screen transitions belong to the session store's own tests.
export function createFakeStore(snapshot: SessionSnapshot) {
  return {
    subscribe: () => () => {},
    getSnapshot: () => snapshot,
    signInWithEmail: vi.fn<SessionStore['signInWithEmail']>(async () => null),
    signInWithGoogle: vi.fn<SessionStore['signInWithGoogle']>(async () => null),
    signOut: vi.fn<SessionStore['signOut']>(async () => {}),
    retryBackendCheck: vi.fn<SessionIdentitySource['retryBackendCheck']>(() => {}),
  } satisfies SessionStore & Pick<SessionIdentitySource, 'retryBackendCheck'>
}
