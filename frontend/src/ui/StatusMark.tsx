import type { BaitSiteStatus, ReplayResult } from '../core/baitSiteStateMachine'

// A bait site's status as a small circle (decision O4 of slice F4-0), placed next to the text
// that already says the status. Takes only the replay, so the map's marker can reuse it
// without a BaitSiteView.

// Keyed by every status: a new status does not compile until it has a look.
const MODIFIER = {
  EMPTY: 'status-mark--empty',
  ARMED: 'status-mark--armed',
  ACTIVE: 'status-mark--active',
  CAPTURED: 'status-mark--captured',
  LOST: 'status-mark--lost',
} satisfies Record<BaitSiteStatus, string>

interface StatusMarkProps {
  replay: ReplayResult
}

function StatusMark({ replay }: StatusMarkProps) {
  // Nothing for an invalid history: "Histórico inválido" next to it already says it.
  if (!replay.valid) return null
  // aria-hidden: the text next to it already says the status; read once, not twice.
  return <span className={`status-mark ${MODIFIER[replay.status]}`} aria-hidden="true" />
}

export default StatusMark
