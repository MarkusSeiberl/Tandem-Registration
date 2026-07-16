import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Sign from './Sign'

// jsdom does not implement a real canvas 2D rendering context (see
// https://github.com/jsdom/jsdom/issues/1782): HTMLCanvasElement.getContext()
// returns null and toDataURL() is a no-op stub. To exercise Sign's drawing
// logic and its interaction with the canvas API, we install a minimal fake
// context/toDataURL ourselves rather than pulling in a canvas-mock package.
// This is a behavior-level mock (call tracking on fillRect/stroke/etc.), not
// a pixel-level one — true "is the first stroke still visible" pixel
// assertions aren't feasible in jsdom. The mock still lets us verify the
// exact regression from the bug report: that the white background fill
// (fillRect) happens exactly once (on mount) and is never re-triggered by
// the hasDrawn state change caused by the first pointermove.
function installFakeCanvasContext() {
  const fillRect = vi.fn()
  const stroke = vi.fn()
  const beginPath = vi.fn()
  const moveTo = vi.fn()
  const lineTo = vi.fn()

  const fakeContext = {
    fillRect,
    stroke,
    beginPath,
    moveTo,
    lineTo,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt' as CanvasLineCap,
  } as unknown as CanvasRenderingContext2D

  const getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(fakeContext)

  const toDataURLSpy = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue('data:image/png;base64,AAAA')

  // jsdom's HTMLCanvasElement doesn't implement setPointerCapture at all
  // (not even as a stub), so vi.spyOn would fail with "property not
  // defined". Assign a plain no-op instead.
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn()

  return { fillRect, stroke, getContextSpy, toDataURLSpy }
}

describe('Sign', () => {
  let mocks: ReturnType<typeof installFakeCanvasContext>

  beforeEach(() => {
    mocks = installFakeCanvasContext()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('enables "Weiter" and produces a PNG data URL after a pointer stroke, without erasing the first segment', () => {
    const onNext = vi.fn()
    render(<Sign onNext={onNext} />)

    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    expect(canvas).toBeTruthy()

    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()

    // The white background must be painted exactly once, on mount, before
    // any drawing happens.
    expect(mocks.fillRect).toHaveBeenCalledTimes(1)

    // Simulate a single pointer stroke: down, a few moves, then up.
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 14, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 25, clientY: 16, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 25, clientY: 16, pointerId: 1 })

    // The first pointermove sets hasDrawn(true), triggering a re-render.
    // This is exactly the scenario that used to re-fire the callback ref
    // and wipe the canvas with a second fillRect call. Assert that did NOT
    // happen: the white fill must still have run only once in total.
    expect(mocks.fillRect).toHaveBeenCalledTimes(1)

    // All stroke segments were actually drawn (none lost/skipped).
    expect(mocks.stroke).toHaveBeenCalledTimes(3)

    expect(submit).toBeEnabled()

    fireEvent.click(submit)

    expect(onNext).toHaveBeenCalledTimes(1)
    const signaturePng = onNext.mock.calls[0][0] as string
    expect(signaturePng.startsWith('data:image/png')).toBe(true)

    // Still exactly one background fill across the whole lifecycle up to
    // submit.
    expect(mocks.fillRect).toHaveBeenCalledTimes(1)
  })

  it('"Löschen" repaints the background and disables "Weiter" again', () => {
    const onNext = vi.fn()
    render(<Sign onNext={onNext} />)

    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    const submit = screen.getByRole('button', { name: 'Weiter' })
    const clear = screen.getByRole('button', { name: 'Löschen' })

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    expect(submit).toBeEnabled()

    fireEvent.click(clear)

    expect(submit).toBeDisabled()
    // Mount fill + clear fill = 2.
    expect(mocks.fillRect).toHaveBeenCalledTimes(2)
    expect(onNext).not.toHaveBeenCalled()
  })
})
