/**
 * The part of window this adapter reads. matchMedia is optional: jsdom (tests) has none.
 * navigator is a plain object because navigator.standalone is not in the DOM types.
 */
export interface DisplayModeEnv {
  readonly matchMedia?: (query: string) => { readonly matches: boolean }
  readonly navigator: object
}

/**
 * True when running as an installed app (home screen), on Android/desktop or iOS (ADR 0008,
 * decision 11). Read once per run in main.tsx: it does not change while the page is open.
 */
export function isInstalledApp(env: DisplayModeEnv = window): boolean {
  if (typeof env.matchMedia === 'function' && env.matchMedia('(display-mode: standalone)').matches) return true
  // iOS Safari: the display-mode media query is not reliable there; navigator.standalone is.
  const { navigator } = env
  return 'standalone' in navigator && navigator.standalone === true
}
