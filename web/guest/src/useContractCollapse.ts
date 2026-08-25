import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
    if (!metrics || !scrolledToEnd) return

    let frame = 0
    const apply = () => {
      frame = 0
      // The page is held still until the text has been read (useScrollLock), so
      // the scroll position *is* the collapse distance — no separate starting
      // point to record, and none to record a frame too late either.
      setCollapsed(Math.min(Math.max(window.scrollY, 0), metrics.full - metrics.min))
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

  // Shrinking a scroll box leaves its scrollTop where it was, so the end of the
  // text would slide back out of view and the box would stop being "at the end"
  // — the guest would watch the contract rewind while it collapses, and
  // useTouchScrollChain would hand nothing over any more. Pinning it to the
  // bottom on every step keeps the last line the last line.
  useLayoutEffect(() => {
    if (!scrolledToEnd || !metrics) return
    const el = textRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [collapsed, scrolledToEnd, metrics, textRef])

  if (!metrics) return { height: null, spacerHeight: 0 }
  return { height: metrics.full - collapsed, spacerHeight: collapsed }
}
