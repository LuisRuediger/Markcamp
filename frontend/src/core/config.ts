export interface FirebaseConfig {
  readonly apiKey: string
  readonly authDomain: string
  readonly projectId: string
  readonly appId: string
}

export interface RawFirebaseEnv {
  readonly VITE_FIREBASE_API_KEY: string | undefined
  readonly VITE_FIREBASE_AUTH_DOMAIN: string | undefined
  readonly VITE_FIREBASE_PROJECT_ID: string | undefined
  readonly VITE_FIREBASE_APP_ID: string | undefined
}

export type FirebaseConfigResult =
  | { readonly ok: true; readonly config: FirebaseConfig }
  | { readonly ok: false; readonly missing: readonly string[] }

export function parseFirebaseConfig(env: RawFirebaseEnv): FirebaseConfigResult {
  const apiKey = env.VITE_FIREBASE_API_KEY?.trim() ?? ''
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN?.trim() ?? ''
  const projectId = env.VITE_FIREBASE_PROJECT_ID?.trim() ?? ''
  const appId = env.VITE_FIREBASE_APP_ID?.trim() ?? ''

  const missing: string[] = []
  if (apiKey === '') missing.push('VITE_FIREBASE_API_KEY')
  if (authDomain === '') missing.push('VITE_FIREBASE_AUTH_DOMAIN')
  if (projectId === '') missing.push('VITE_FIREBASE_PROJECT_ID')
  if (appId === '') missing.push('VITE_FIREBASE_APP_ID')

  if (missing.length > 0) return { ok: false, missing }
  return { ok: true, config: { apiKey, authDomain, projectId, appId } }
}
