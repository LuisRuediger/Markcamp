/**
 * Maps the Firebase uid of this device's accounts to their internal user id (ADR 0008,
 * decision 9), so the right local database opens offline: Firebase restores the session
 * without network, GET /api/me does not.
 *
 * The internal id, not the uid, names the user's database (ADR 0008, decision 4): the uid
 * belongs to the auth provider, which ADR 0004 allows replacing, while the internal id is
 * ours. The uid stays on the device, only in this mapping, and is never logged (ADR 0008,
 * derived rule 8).
 *
 * Contract (checked by localAccounts.suite.ts against every implementation):
 * - userIdFor() of a uid never remembered is null.
 * - remember() overwrites: recreating the dev database in Docker gives the same uid a new
 *   internal id (ADR 0008, consequences).
 * - Two uids never see each other's id.
 */
export interface LocalAccounts {
  userIdFor(uid: string): Promise<string | null>
  remember(uid: string, userId: string): Promise<void>
}
