import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

/** Room for the reading hint pinned to the bottom edge, so "reached" means the
 *  end of the contract stood where the guest could read it, not behind the hint. */
const HINT_ROOM = 72

/**
 * Reports whether the guest has scrolled to the marker at the end of the
 * contract — the proof-of-reading gate, on the one scroll surface this screen
 * has: the page itself.
 *
 * Watching a marker rather than a scroll offset is what keeps this honest when
 * the text reflows (rotation, a longer Vertragstext, a bigger font on the
 * tablet): the end of the text is wherever the end of the text is.
 *
 * It is a position check on every frame the page moves, deliberately not an
 * IntersectionObserver. An observer only reports threshold crossings, and a
 * flick that carries the marker from below the screen to above it between two
 * frames crosses nothing it can see — the gate would stay shut for a guest who
 * scrolled all the way through. Asking "is the end at or above the fold" gives
 * the same answer whether it was passed slowly or in one throw.
 *
 * Once reached it stays reached. A guest who scrolls back up to re-read has
 * still read it, and re-locking the send button behind them would be a puzzle,
 * not a safeguard.
 */
export function useReachedEnd(ref: RefObject<Element | null>, ready: boolean): boolean {
  const [reached, setReached] = useState(false)

  useEffect(() => {
    if (!ready || reached) return

    let frame = 0
    const check = () => {
      frame = 0
      const el = ref.current
      if (!el) return
      const viewport = window.visualViewport?.height || window.innerHeight
      // Where there is no layout to measure (jsdom, an engine without
      // getBoundingClientRect worth the name) every rect is zero and the gate
      // opens. A "Weiter" that can never unlock is worse than a gate that lets
      // a guest through.
      if (el.getBoundingClientRect().top <= viewport - HINT_ROOM) setReached(true)
    }

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check)
    }

    check()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ref, ready, reached])

  return reached
}
