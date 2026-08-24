import { useEffect } from 'react'

/**
 * Publishes the visual viewport's height as `--app-h`.
 *
 * The app shell is pinned to the window so the page itself never scrolls, and
 * the one thing that must never happen is the guest losing sight of "Weiter"
 * when the keyboard comes up.
 *
 * `interactive-widget=resizes-content` in index.html is the primary fix: it
 * tells Android Chrome to shrink the layout viewport, which makes `100svh`
 * correct on its own. This hook is the belt to that pair of braces — the flag
 * is honoured by Chrome 108+ and ignored by everything older, and a kiosk
 * tablet is exactly the device nobody updates. Reading `visualViewport.height`
 * back works either way.
 *
 * Where there is no visualViewport (jsdom, older engines) this writes nothing
 * and the `100svh` fallback in the CSS stands.
 */
export function useViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const apply = () => {
      document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
    }
    apply()

    // `scroll` as well as `resize`: the visual viewport is also offset, not only
    // resized, while the keyboard animates in and out.
    vv.addEventListener('resize', apply)
    vv.addEventListener('scroll', apply)
    return () => {
      vv.removeEventListener('resize', apply)
      vv.removeEventListener('scroll', apply)
    }
  }, [])
}
