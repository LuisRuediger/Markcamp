// Types for the VITE_* variables read in src/main.tsx. A variable absent from .env.local
// is undefined at runtime, and parseFirebaseConfig and parseMapConfig in core handle that.
interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string | undefined
  readonly VITE_FIREBASE_AUTH_DOMAIN: string | undefined
  readonly VITE_FIREBASE_PROJECT_ID: string | undefined
  readonly VITE_FIREBASE_APP_ID: string | undefined
  readonly VITE_THUNDERFOREST_API_KEY: string | undefined
}

// The build's commit hash (vite.config.ts, define). Read only in src/main.tsx.
declare const __APP_VERSION__: string
