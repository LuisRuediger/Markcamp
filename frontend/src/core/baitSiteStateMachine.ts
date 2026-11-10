export const BAIT_SITE_EVENT_TYPES = [
  'INSTALLED',
  'ACTIVITY',
  'CAPTURED',
  'LOST',
  'COLLECTED',
  'REMOVED',
  'INSPECTED',
  'IDENTIFIED',
] as const

export type BaitSiteEventType = (typeof BAIT_SITE_EVENT_TYPES)[number]

export const BAIT_SITE_STATUSES = ['EMPTY', 'ARMED', 'ACTIVE', 'CAPTURED', 'LOST'] as const

export type BaitSiteStatus = (typeof BAIT_SITE_STATUSES)[number]

export interface ReplayEvent {
  readonly id: string
  readonly type: BaitSiteEventType
  readonly identifiedEventId: string | null
}

export type ReplayResult =
  | { readonly valid: true; readonly status: BaitSiteStatus }
  | { readonly valid: false; readonly firstInvalidIndex: number }

// Records keyed by every event type: a new event type does not compile until it has a row
// in both tables. The TypeScript counterpart of the Java switch with no default.

// "Allowed when the status is" in ADR 0005, copied from BaitSiteStateMachine.allowedFrom.
const ALLOWED_FROM: Record<BaitSiteEventType, readonly BaitSiteStatus[]> = {
  INSTALLED: ['EMPTY', 'LOST'],
  ACTIVITY: ['ARMED', 'ACTIVE'],
  CAPTURED: ['ARMED', 'ACTIVE', 'LOST'],
  LOST: ['CAPTURED'],
  COLLECTED: ['CAPTURED'],
  REMOVED: ['ARMED', 'ACTIVE', 'LOST'],
  // Derived from the list, like EnumSet.complementOf in Java: a new status is included.
  INSPECTED: BAIT_SITE_STATUSES.filter((status) => status !== 'EMPTY'),
  // Any status. What it does depend on is the capture it points to, checked in replay().
  IDENTIFIED: BAIT_SITE_STATUSES,
}

// "Status after" in ADR 0005, from BaitSiteEventType. null leaves the status unchanged.
// `satisfies` keeps the literal types, so STATUS_AFTER.INSTALLED is known not to be null.
const STATUS_AFTER = {
  INSTALLED: 'ARMED',
  ACTIVITY: 'ACTIVE',
  CAPTURED: 'CAPTURED',
  LOST: 'LOST',
  COLLECTED: 'EMPTY',
  REMOVED: 'EMPTY',
  INSPECTED: null,
  IDENTIFIED: null,
} as const satisfies Record<BaitSiteEventType, BaitSiteStatus | null>

/**
 * The transition table of ADR 0005. `shared/bait-site-state-machine-cases.json` is the
 * contract: this function must give the same result as the Java BaitSiteStateMachine for
 * every case in it.
 *
 * It does not sort. It receives the non-voided events of one site, already in history
 * order (see historyOrder.ts); filtering out voided events is the caller's job. An empty
 * history is valid and EMPTY: it happens only when every event was voided.
 */
export function replay(eventsInHistoryOrder: readonly ReplayEvent[]): ReplayResult {
  const [first, ...rest] = eventsInHistoryOrder
  if (first === undefined) {
    return { valid: true, status: 'EMPTY' }
  }
  // Before the first event the status is "none" in ADR 0005: only INSTALLED is allowed.
  // Handled apart so that `status` is never null below, with no cast.
  if (first.type !== 'INSTALLED') {
    return { valid: false, firstInvalidIndex: 0 }
  }
  let status: BaitSiteStatus = STATUS_AFTER.INSTALLED
  // Equality only, which is the same on the device, in Java and in Postgres. A voided
  // capture needs no code here: it is not in the history, so it never enters this set.
  const earlierCaptures = new Set<string>()

  for (const [offset, event] of rest.entries()) {
    const index = offset + 1
    let allowed = ALLOWED_FROM[event.type].includes(status)
    if (
      event.type === 'IDENTIFIED' &&
      (event.identifiedEventId === null || !earlierCaptures.has(event.identifiedEventId))
    ) {
      allowed = false
    }
    if (!allowed) {
      return { valid: false, firstInvalidIndex: index }
    }
    // Recorded only once accepted: a rejected capture stops the replay anyway.
    if (event.type === 'CAPTURED') {
      earlierCaptures.add(event.id)
    }
    status = STATUS_AFTER[event.type] ?? status
  }
  return { valid: true, status }
}
