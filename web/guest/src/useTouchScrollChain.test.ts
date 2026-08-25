import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useTouchScrollChain } from './useTouchScrollChain'

// jsdom has no layout, so the box's scroll geometry is written by hand.
function box({ scrollTop, clientHeight, scrollHeight }: Record<string, number>): HTMLDivElement {
  const el = document.createElement('div')
  Object.defineProperty(el, 'scrollTop', { value: scrollTop, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  document.body.append(el)
  return el
}

const atEnd = () => box({ scrollTop: 700, clientHeight: 300, scrollHeight: 1000 })
const midway = () => box({ scrollTop: 200, clientHeight: 300, scrollHeight: 1000 })

// jsdom's TouchEvent carries no touches, so the events are built by hand with
// only the one field the hook reads.
function touch(el: HTMLElement, type: string, clientY: number): Event {
  const e = new Event(type, { bubbles: true, cancelable: type === 'touchmove' })
  Object.defineProperty(e, 'touches', { value: [{ clientY }] })
  el.dispatchEvent(e)
  return e
}

function drag(el: HTMLElement, from: number, to: number) {
  touch(el, 'touchstart', from)
  return touch(el, 'touchmove', to)
}

let scrollBy: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollBy = vi.fn()
  vi.stubGlobal('scrollBy', scrollBy)
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('useTouchScrollChain', () => {
  it('scrolls the page with what is left of the drag once the text ends', () => {
    const el = atEnd()
    renderHook(() => useTouchScrollChain({ current: el }))

    // Finger travels 40px up: the box has nothing left, so the page takes it.
    const e = drag(el, 400, 360)
    expect(scrollBy).toHaveBeenCalledWith(0, 40)
    expect(e.defaultPrevented).toBe(true)
  })

  it('leaves the drag to the box while there is text left to read', () => {
    const el = midway()
    renderHook(() => useTouchScrollChain({ current: el }))

    const e = drag(el, 400, 360)
    expect(scrollBy).not.toHaveBeenCalled()
    expect(e.defaultPrevented).toBe(false)
  })

  it('undoes the page before the text on the way back', () => {
    const el = atEnd()
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
    renderHook(() => useTouchScrollChain({ current: el }))

    // Finger travels 30px down while the page is collapsed: the page grows back
    // first, even though the box could scroll up.
    drag(el, 360, 390)
    expect(scrollBy).toHaveBeenCalledWith(0, -30)
  })

  it('leaves the box to scroll back up once the page is home again', () => {
    const el = atEnd()
    renderHook(() => useTouchScrollChain({ current: el }))

    drag(el, 360, 390)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('follows the finger across a whole gesture, not just its first step', () => {
    const el = atEnd()
    renderHook(() => useTouchScrollChain({ current: el }))

    touch(el, 'touchstart', 400)
    touch(el, 'touchmove', 380)
    touch(el, 'touchmove', 350)
    expect(scrollBy).toHaveBeenNthCalledWith(1, 0, 20)
    expect(scrollBy).toHaveBeenNthCalledWith(2, 0, 30)
  })

  it('forgets the finger when the gesture ends', () => {
    const el = atEnd()
    renderHook(() => useTouchScrollChain({ current: el }))

    touch(el, 'touchstart', 400)
    touch(el, 'touchend', 400)
    // A move without a start belongs to no gesture; taking it would jump the
    // page by the distance between two unrelated touches.
    touch(el, 'touchmove', 200)
    expect(scrollBy).not.toHaveBeenCalled()
  })

  it('stops listening when the screen unmounts', () => {
    const el = atEnd()
    const { unmount } = renderHook(() => useTouchScrollChain({ current: el }))
    unmount()
    drag(el, 400, 360)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
