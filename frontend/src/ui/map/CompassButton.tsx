import { useEffect, useRef, type Ref } from 'react'
import { ptBR } from '../i18n/pt-BR'
import type { HeadingSource } from './useCompass'

// The compass button (decision W7 of slice F4-5): a rose with N, S, O and L, the L in honey
// (bait entrances face sunrise). On, the rose turns by minus the true heading, so its N points
// to the world's north. The rotation is written straight into the SVG from the source's
// deliveries, never through React state; no CSS transition (from 359° to 1° it would spin the
// whole way round).

export interface CompassButtonProps {
  on: boolean
  /** On in landscape: the rose keeps its last rotation and fades. */
  landscape: boolean
  source: HeadingSource | null
  onToggle: () => void
  buttonRef?: Ref<HTMLButtonElement>
}

function rotation(trueDeg: number): string {
  return `rotate(${-trueDeg} 18 18)`
}

function CompassButton({ on, landscape, source, onToggle, buttonRef }: CompassButtonProps) {
  const rose = useRef<SVGGElement>(null)

  useEffect(() => {
    const element = rose.current
    if (element === null) return
    if (source === null) {
      // Off: N up again, the map's north. On without a source (landscape, hidden page, waiting
      // for the first heading): the last rotation stays.
      if (!on) element.setAttribute('transform', rotation(0))
      return
    }
    const write = (trueDeg: number) => element.setAttribute('transform', rotation(trueDeg))
    const now = source.current()
    if (now !== null) write(now)
    return source.subscribe(write)
  }, [source, on])

  return (
    <button
      ref={buttonRef}
      type="button"
      className={on && landscape ? 'map-compass map-compass--landscape' : 'map-compass'}
      aria-pressed={on}
      aria-label={ptBR.map.compass}
      onClick={onToggle}
    >
      <svg viewBox="0 0 36 36" width="40" height="40" aria-hidden="true">
        <g ref={rose}>
          <text className="map-compass__north" x="18" y="8.2" fontSize="7.5" fontWeight="700" textAnchor="middle">
            N
          </text>
          <polygon className="map-compass__north" points="18,10 21.2,18 14.8,18" />
          <polygon className="map-compass__south" points="18,26 14.8,18 21.2,18" />
          <text className="map-compass__side" x="18" y="33.6" fontSize="6.5" fontWeight="600" textAnchor="middle">
            S
          </text>
          <text className="map-compass__side" x="4.6" y="20.3" fontSize="6.5" fontWeight="600" textAnchor="middle">
            O
          </text>
          <circle cx="31" cy="18" r="4.7" fill="var(--color-honey)" />
          <text x="31" y="20.4" fontSize="6.5" fontWeight="700" textAnchor="middle" fill="var(--color-on-honey)">
            L
          </text>
        </g>
      </svg>
    </button>
  )
}

export default CompassButton
