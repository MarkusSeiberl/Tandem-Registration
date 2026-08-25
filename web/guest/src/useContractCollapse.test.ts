import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useContractCollapse } from './useContractCollapse'

const VIEWPORT = 800
const BOX_TOP = 120
const HINT_HEIGHT = 44
const GAP = 12

// fullH as the hook computes it: what is left of the screen below the box, minus
// the room the scroll hint needs to stay visible.
const FULL = VIEWPORT - BOX_TOP - HINT_HEIGHT - GAP
const MIN = Math.max(VIEWPORT * 0.35, 200)

// jsdom lays nothing out, so every element the hook measures is a stand-in with
// a hand-written rect. A `height` of 0 is the hook's signal that no layout
// exists at all — the tests that want a measurable box therefore give one.
function boxWithLayout(top = BOX_TOP, height = 300): HTMLDivElement {
  const el = document.createElement('div')
  el.getBoundingClientRect = () => ({ top, height, bottom: top + height }) as DOMRect
  return el
}

function hintWithLayout(height = HINT_HEIGHT): HTMLParagraphElement {
  const el = document.createElement('p')
  el.getBoundingClientRect = () => ({ top: 0, height, bottom: height }) as DOMRect
  return el
}

// The hook throttles scroll through requestAnimationFrame, so the assertions
// have to wait for the frame that carries the new height.
async function scrollTo(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
  await act(async () => {
    window.dispatchEvent(new Event('scroll'))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
}

// The refs are built once, outside the render callback: a real caller passes
// `useRef` objects, whose identity holds still across renders.
function collapse(box: HTMLElement | null, hint: HTMLElement | null, scrolledToEnd: boolean) {
  const textRef = { current: box }
  const hintRef = { current: hint }
  return renderHook(
    ({ end }: { end: boolean }) =>
      useContractCollapse(textRef, hintRef, { ready: true, scrolledToEnd: end }),
    { initialProps: { end: scrolledToEnd } },
  )
}

beforeEach(() => {
  Object.defineProperty(window, 'innerHeight', { value: VIEWPORT, configurable: true })
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useContractCollapse', () => {
  it('fills the screen below the box on load, leaving room for the scroll hint', () => {
    const { result } = collapse(boxWithLayout(), hintWithLayout(), false)
    expect(result.current.height).toBe(FULL)
    expect(result.current.spacerHeight).toBe(0)
  })

  it('stays at full height while the guest has not read to the end', async () => {
    const { result } = collapse(boxWithLayout(), hintWithLayout(), false)
    await scrollTo(150)
    expect(result.current.height).toBe(FULL)
    expect(result.current.spacerHeight).toBe(0)
  })

  it('shrinks by exactly what was scrolled once the text has been read', async () => {
    const { result, rerender } = collapse(boxWithLayout(), hintWithLayout(), false)
    rerender({ end: true })
    await scrollTo(100)
    expect(result.current.height).toBe(FULL - 100)
  })

  it('measures the collapse from the scroll position the text was read at', async () => {
    const { result, rerender } = collapse(boxWithLayout(), hintWithLayout(), false)
    // The guest pushed the page down a little before finishing the text.
    await scrollTo(60)
    rerender({ end: true })
    await scrollTo(160)
    expect(result.current.height).toBe(FULL - 100)
  })

  it('never shrinks past the minimum height', async () => {
    const { result, rerender } = collapse(boxWithLayout(), hintWithLayout(), false)
    rerender({ end: true })
    await scrollTo(10_000)
    expect(result.current.height).toBe(MIN)
  })

  it('keeps height plus spacer constant so the document does not shorten', async () => {
    const { result, rerender } = collapse(boxWithLayout(), hintWithLayout(), false)
    rerender({ end: true })
    for (const y of [0, 40, 200, 10_000]) {
      await scrollTo(y)
      expect(result.current.height! + result.current.spacerHeight).toBe(FULL)
    }
  })

  it('grows back when the guest scrolls up again', async () => {
    const { result, rerender } = collapse(boxWithLayout(), hintWithLayout(), false)
    rerender({ end: true })
    await scrollTo(200)
    await scrollTo(0)
    expect(result.current.height).toBe(FULL)
    expect(result.current.spacerHeight).toBe(0)
  })

  it('leaves the CSS fallback in place where nothing can be measured', () => {
    const box = document.createElement('div')
    box.getBoundingClientRect = () => ({ top: 0, height: 0, bottom: 0 }) as DOMRect
    const { result } = collapse(box, null, false)
    expect(result.current.height).toBeNull()
    expect(result.current.spacerHeight).toBe(0)
  })

  it('waits for the real text before measuring', () => {
    const textRef = { current: boxWithLayout() }
    const hintRef = { current: hintWithLayout() }
    const { result } = renderHook(() =>
      useContractCollapse(textRef, hintRef, { ready: false, scrolledToEnd: false }),
    )
    expect(result.current.height).toBeNull()
  })

  it('stops listening when the screen unmounts', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = collapse(boxWithLayout(), hintWithLayout(), true)
    unmount()
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
  })
})
