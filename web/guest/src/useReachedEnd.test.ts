import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useReachedEnd } from './useReachedEnd'

const VIEWPORT = 800

// jsdom lays nothing out, so the marker's position is written by hand — `top`
// is where the end of the contract sits relative to the top of the screen.
function markerAt(top: number): HTMLDivElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, height: 1, bottom: top + 1 }) as DOMRect
  return el
}

async function scroll() {
  await act(async () => {
    window.dispatchEvent(new Event('scroll'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

function gate(el: Element, ready = true) {
  const ref = { current: el }
  return renderHook(({ r }: { r: boolean }) => useReachedEnd(ref, r), { initialProps: { r: ready } })
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: VIEWPORT, configurable: true })
})

afterEach(() => {
  document.body.innerHTML = ''
})

describe('useReachedEnd', () => {
  it('stays shut while the end of the contract is below the screen', () => {
    const { result } = gate(markerAt(4000))
    expect(result.current).toBe(false)
  })

  it('stays shut while the end is only behind the reading hint', () => {
    // 72px of the bottom edge belong to the hint; text under it is not read.
    const { result } = gate(markerAt(VIEWPORT - 40))
    expect(result.current).toBe(false)
  })

  it('opens once the end stands clear of the hint', async () => {
    const marker = markerAt(4000)
    const { result } = gate(marker)

    marker.getBoundingClientRect = () => ({ top: VIEWPORT - 100, height: 1 }) as DOMRect
    await scroll()

    expect(result.current).toBe(true)
  })

  it('opens for a flick that throws the end past the screen in one frame', async () => {
    // The case an IntersectionObserver misses: below the fold on one frame,
    // above it on the next, never intersecting in between.
    const marker = markerAt(4000)
    const { result } = gate(marker)

    marker.getBoundingClientRect = () => ({ top: -2500, height: 1 }) as DOMRect
    await scroll()

    expect(result.current).toBe(true)
  })

  it('opens straight away for a contract that fits on the screen', () => {
    const { result } = gate(markerAt(300))
    expect(result.current).toBe(true)
  })

  it('stays open when the guest scrolls back up to re-read', async () => {
    const marker = markerAt(300)
    const { result } = gate(marker)

    marker.getBoundingClientRect = () => ({ top: 4000, height: 1 }) as DOMRect
    await scroll()

    expect(result.current).toBe(true)
  })

  it('waits for the real text before deciding anything', async () => {
    const marker = markerAt(300)
    const { result, rerender } = gate(marker, false)
    expect(result.current).toBe(false)

    rerender({ r: true })
    expect(result.current).toBe(true)
  })

  it('stops listening once the gate is open', async () => {
    const marker = markerAt(4000)
    const { result } = gate(marker)
    marker.getBoundingClientRect = () => ({ top: 0, height: 1 }) as DOMRect
    await scroll()
    expect(result.current).toBe(true)

    // A second pass must not keep a listener alive for the rest of the screen.
    marker.getBoundingClientRect = () => {
      throw new Error('the gate is still measuring after it opened')
    }
    await scroll()
    expect(result.current).toBe(true)
  })
})
