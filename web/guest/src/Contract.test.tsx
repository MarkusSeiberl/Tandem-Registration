import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Contract from './Contract'
import * as api from './api'

// jsdom does not implement a real canvas 2D rendering context, so we install a
// minimal fake one (call tracking only) — see the original note this replaces
// in the now-deleted Sign.test.tsx.
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

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA')
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn()
}

describe('Contract', () => {
  beforeEach(() => {
    installFakeCanvasContext()
    vi.spyOn(api, 'getContract').mockResolvedValue('Vertragstext hier.')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the contract text and enables "Weiter" only after a signature is drawn', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)

    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 15, clientY: 12, pointerId: 1 })

    expect(submit).toBeEnabled()

    fireEvent.click(submit)

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).toBe('data:image/png;base64,AAAA')
  })

  it('"Löschen" repaints the background and disables "Weiter" again', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    const submit = screen.getByRole('button', { name: 'Weiter' })
    const clear = screen.getByRole('button', { name: 'Löschen' })

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    expect(submit).toBeEnabled()

    fireEvent.click(clear)

    expect(submit).toBeDisabled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('shows a message when there is no contract text configured', async () => {
    vi.spyOn(api, 'getContract').mockResolvedValue('')
    render(<Contract onNext={vi.fn()} />)

    await waitFor(() =>
      screen.getByText('Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.')
    )
  })
})
