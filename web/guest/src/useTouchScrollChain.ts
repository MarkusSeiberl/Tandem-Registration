import { useEffect } from 'react'
import type { RefObject } from 'react'

/**
 * Carries a finger's leftover scrolling from an inner scroll box on to the page.
 *
 * A touch gesture belongs to one scroller for its whole life: when the contract
 * text hits its end mid-swipe, the browser does not hand the rest of the swipe
 * to the page. The guest has to lift the finger and start again — right at the
 * moment the contract is read and the box is about to collapse, which is the
 * one place the motion should be continuous.
 *
 * So the leftover is passed on by hand: once the box sits at its end, each
 * further pixel of downward drag scrolls the window instead. Dragging back the
 * other way undoes the page first and only then the text, so the way back
 * mirrors the way in.
 *
 * `preventDefault` is best-effort. Chrome marks touchmove non-cancelable once a
 * scroll gesture is underway, and that is fine here: at that point the box has
 * nothing left to scroll, so there is no second scroll to suppress — only the
 * window movement below, which the browser is not doing on its own.
 */
export function useTouchScrollChain(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return

    let lastY: number | null = null

    const start = (e: TouchEvent) => {
      lastY = e.touches[0]?.clientY ?? null
    }

    const move = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (y === undefined || lastY === null) return
      // Finger travelling up = content travelling down = positive delta, the
      // same sign convention as scrollTop/scrollY.
      const delta = lastY - y
      lastY = y
      if (delta === 0) return

      const atEnd = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      const handOver = delta > 0 ? atEnd : window.scrollY > 0
      if (!handOver) return

      if (e.cancelable) e.preventDefault()
      window.scrollBy(0, delta)
    }

    const end = () => {
      lastY = null
    }

    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end, { passive: true })
    el.addEventListener('touchcancel', end, { passive: true })
    return () => {
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [ref])
}
