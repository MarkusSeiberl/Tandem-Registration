import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUpdateEvents } from './useEvents'
import { eventSourceOpenCount, fireRawEvent, fireUpdateEvent } from './setupTests'
import type { UpdateStatus } from './api'

const status: UpdateStatus = {
  phase: 'available',
  currentVersion: '1.0.0',
  latestVersion: '1.1.0',
  notes: null,
  downloadedBytes: 0,
  totalBytes: 0,
  error: null,
  checkedAt: null,
  allowed: true,
  promptPending: false,
  openToday: 0,
}

describe('useUpdateEvents', () => {
  it('opens no connection at all when disabled — the guard every tablet relies on', () => {
    const onStatus = vi.fn()
    renderHook(() => useUpdateEvents(false, onStatus))

    // Asserting the count (not just silence) is the point: a guard that opened
    // the connection but forgot to register the listener would still leave the
    // callback unfired, yet leak exactly the connection this design forbids.
    expect(eventSourceOpenCount()).toBe(0)
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('opens exactly one connection when enabled and delivers a parsed update', () => {
    const onStatus = vi.fn()
    renderHook(() => useUpdateEvents(true, onStatus))

    expect(eventSourceOpenCount()).toBe(1)

    fireUpdateEvent(status)
    expect(onStatus).toHaveBeenCalledTimes(1)
    expect(onStatus).toHaveBeenCalledWith(status)
  })

  it('closes the connection on unmount', () => {
    const { unmount } = renderHook(() => useUpdateEvents(true, vi.fn()))
    expect(eventSourceOpenCount()).toBe(1)

    unmount()
    expect(eventSourceOpenCount()).toBe(0)
  })

  it('closes the connection when enabled flips from true to false', () => {
    const { rerender } = renderHook(
      ({ enabled }) => useUpdateEvents(enabled, vi.fn()),
      { initialProps: { enabled: true } },
    )
    expect(eventSourceOpenCount()).toBe(1)

    rerender({ enabled: false })
    expect(eventSourceOpenCount()).toBe(0)
  })

  it('swallows a malformed frame without throwing or calling back', () => {
    const onStatus = vi.fn()
    renderHook(() => useUpdateEvents(true, onStatus))

    // Raw, not run through fireUpdateEvent's JSON.stringify — a real server
    // frame that is not valid JSON, which is exactly what JSON.parse must reject.
    expect(() => fireRawEvent('update', '{not json')).not.toThrow()

    expect(onStatus).not.toHaveBeenCalled()
  })
})
