import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

export interface ContractCollapse {
  /** Height for the contract text box, or `null` when nothing could be measured. */
  height: number | null
  /** Height of the spacer that holds the document's total height steady. */
  spacerHeight: number
}

/** Breathing room below the scroll hint, so the box does not end flush at the edge. */
const GAP = 12

/** The contract never collapses away entirely — the guest signs what is on screen. */
const MIN_FRACTION = 0.35
const MIN_PX = 200

interface Metrics {
  full: number
  min: number
}

/**
 * Height of the contract text box, as a function of the page's scroll position.
 *
 * On load the box is as tall as what is left of the screen below it (minus the
 * scroll hint, which exists to be seen). Once the guest has scrolled the text to
 * its end, every further pixel of page scroll takes a pixel off the box, down to
 * `min` — so Datenschutz and signature rise into view as one continuous motion
 * rather than after a jump.
 *
 * The spacer is the other half of that: shrinking the box shortens the document
 * by exactly as much as the guest just scrolled, the browser clamps `scrollY` to
 * the new maximum, and the collapse fights itself to a standstill. What the box
 * gives up, the spacer takes on, and the scroll range stays put.
 *
 * Where there is no layout to measure — jsdom, or before the box is in the DOM —
 * this returns `null` and the `max-height` from the stylesheet stands.
 */
export function useContractCollapse(
  textRef: RefObject<HTMLElement | null>,
  hintRef: RefObject<HTMLElement | null>,
  { ready, scrolledToEnd }: { ready: boolean; scrolledToEnd: boolean },
): ContractCollapse {
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [collapsed, setCollapsed] = useState(0)

  // The scroll position at which the text was read to the end. The collapse is
  // measured from there, not from the top of the document: a guest who nudged
  // the page down while reading must not find the box already half shut.
  const baselineRef = useRef<number | null>(null)

  // The hint is unmounted the moment the gate opens, so its height is kept here
  // for later re-measurements (a rotated tablet) — otherwise the box would grow
  // by the height of an element that is no longer there.
  const hintHeightRef = useRef(0)

  useEffect(() => {
    if (!ready) return

    const measure = () => {
      const el = textRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      // No layout at all: nothing to compute a screen-filling height from.
      if (rect.height === 0) return null

      const viewport = window.visualViewport?.height || window.innerHeight
      if (!viewport) return null

      const hint = hintRef.current
      if (hint) hintHeightRef.current = hint.getBoundingClientRect().height

      // The box's own top edge in the unscrolled document. It does not move when
      // the box shrinks, so this stays valid across the whole collapse.
      const top = rect.top + window.scrollY
      const min = Math.max(viewport * MIN_FRACTION, MIN_PX)
      const full = viewport - top - hintHeightRef.current - GAP
      return { full: Math.max(full, min), min }
    }

    const remeasure = () => setMetrics(measure())
    remeasure()

    window.addEventListener('resize', remeasure)
    window.visualViewport?.addEventListener('resize', remeasure)
    return () => {
      window.removeEventListener('resize', remeasure)
      window.visualViewport?.removeEventListener('resize', remeasure)
    }
  }, [ready, textRef, hintRef])

  useEffect(() => {
    if (!scrolledToEnd) {
      baselineRef.current = null
      setCollapsed(0)
      return
    }
    baselineRef.current = window.scrollY
  }, [scrolledToEnd])

  useEffect(() => {
    if (!metrics || !scrolledToEnd) return

    let frame = 0
    const apply = () => {
      frame = 0
      const travelled = window.scrollY - (baselineRef.current ?? window.scrollY)
      setCollapsed(Math.min(Math.max(travelled, 0), metrics.full - metrics.min))
    }
    // `scroll` fires in dense bursts on a touch screen; one frame is one render.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(apply)
    }

    apply()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [metrics, scrolledToEnd])

  if (!metrics) return { height: null, spacerHeight: 0 }
  return { height: metrics.full - collapsed, spacerHeight: collapsed }
}
