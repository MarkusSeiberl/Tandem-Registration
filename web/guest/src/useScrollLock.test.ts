import { afterEach, describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useScrollLock } from './useScrollLock'

afterEach(() => {
  document.documentElement.style.removeProperty('overflow')
})

describe('useScrollLock', () => {
  it('holds the page still while locked', () => {
    renderHook(() => useScrollLock(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
  })

  it('leaves the page alone when not locked', () => {
    renderHook(() => useScrollLock(false))
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('releases the page when the lock is lifted', () => {
    const { rerender } = renderHook(({ locked }) => useScrollLock(locked), {
      initialProps: { locked: true },
    })
    rerender({ locked: false })
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('releases the page when the screen unmounts', () => {
    const { unmount } = renderHook(() => useScrollLock(true))
    unmount()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('lifts the lock on the spot when asked, without waiting for a render', () => {
    const { result } = renderHook(() => useScrollLock(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
    result.current()
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('puts back whatever the page had before', () => {
    document.documentElement.style.overflow = 'clip'
    const { unmount } = renderHook(() => useScrollLock(true))
    expect(document.documentElement.style.overflow).toBe('hidden')
    unmount()
    expect(document.documentElement.style.overflow).toBe('clip')
  })
})
