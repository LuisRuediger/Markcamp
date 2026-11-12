// One or more labels of lowercase letters, digits and inner hyphens, joined by single
// dots, with at least one dot. No leading dot (in Vite, ".x" allows every subdomain),
// no scheme, port, path, slash, space or uppercase letter.
const LABEL = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?'
const HOST_NAME = new RegExp(`^${LABEL}(?:\\.${LABEL})+$`)

/**
 * preview.allowedHosts from MARKCAMP_PREVIEW_HOST.
 * Unset or empty → [] (preview answers on localhost only, Vite's default).
 * Otherwise exactly one host name, or a thrown Error naming the variable.
 */
export function previewAllowedHosts(value: string | undefined): string[] {
  if (value === undefined || value === '') {
    return []
  }
  if (!HOST_NAME.test(value)) {
    throw new Error(
      `MARKCAMP_PREVIEW_HOST must be a single lowercase host name with at least one dot, ` +
        `such as markcamp-dev.tailb53c35.ts.net (no https://, no port, no slash, no spaces, ` +
        `no leading dot). Got: "${value}"`,
    )
  }
  return [value]
}
