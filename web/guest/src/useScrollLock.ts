import { useCallback, useEffect, useRef } from 'react'

/**
 * Holds the page still while `locked`.
 *
 * The contract text has its own scroll box, but the page behind it scrolls too
 * — so a guest who drags the margin next to the box, or spins a wheel, sails
 * past the contract and lands on the signature without the text ever having
 * moved. The read gate would still be shut, but the screen would already be
 * showing the end of the flow, which is the wrong thing to show someone who has
 * not read the thing they are about to sign.
 *
 * Locked on `documentElement`, not on `body`: the root element's overflow is
 * what the viewport takes its scrolling from, so it does not depend on the
 * propagation rule that only applies while the root says `visible`.
 *
 * Returns a `release`, for the moment the lock has to lift faster than React
 * can re-render. The gate opens in the middle of the very swipe that is about
 * to scroll the page, and a lock that lingers even a few frames swallows the
 * start of that motion — which is the exact seam this is meant to remove.
 * Calling it is safe at any time; the next render settles the style either way.
 */
export function useScrollLock(locked: boolean): () => void {
  const previousRef = useRef('')

  useEffect(() => {
    if (!locked) return
    const root = document.documentElement
    previousRef.current = root.style.overflow
    root.style.overflow = 'hidden'
    return () => {
      root.style.overflow = previousRef.current
    }
  }, [locked])

  return useCallback(() => {
    document.documentElement.style.overflow = previousRef.current
  }, [])
}
