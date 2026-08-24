import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useViewportHeight } from './useViewportHeight'

// jsdom has no visualViewport, so the tests install a controllable stand-in.
function fakeViewport(height: number) {
  const listeners = new Map<string, Set<() => void>>()
  const vv = {
    height,
    addEventListener: (type: string, fn: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: () => void) => {
      listeners.get(type)?.delete(fn)
    },
    emit: (type: string) => listeners.get(type)?.forEach((fn) => fn()),
    listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
  }
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true })
  return vv
}

afterEach(() => {
  document.documentElement.style.removeProperty('--app-h')
  vi.unstubAllGlobals()
})

describe('useViewportHeight', () => {
  it('publishes the visual viewport height on mount', () => {
    fakeViewport(800)
    renderHook(() => useViewportHeight())
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('800px')
  })

  it('follows the viewport shrinking when the keyboard opens', () => {
    const vv = fakeViewport(800)
    renderHook(() => useViewportHeight())

    // Gboard on an 800px landscape screen: the visual viewport shrinks by
    // roughly 45%. On a Chrome too old for `interactive-widget` the layout
    // viewport does not follow, so `svh` alone would leave the action bar
    // behind the keyboard.
    vv.height = 440
    vv.emit('resize')

    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('440px')
  })

  it('stops listening when the app unmounts', () => {
    const vv = fakeViewport(800)
    const { unmount } = renderHook(() => useViewportHeight())
    unmount()
    expect(vv.listenerCount('resize')).toBe(0)
    expect(vv.listenerCount('scroll')).toBe(0)
  })

  it('leaves the CSS fallback in place where there is no visual viewport', () => {
    Object.defineProperty(window, 'visualViewport', { value: undefined, configurable: true })
    renderHook(() => useViewportHeight())
    expect(document.documentElement.style.getPropertyValue('--app-h')).toBe('')
  })
})
