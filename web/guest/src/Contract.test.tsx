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

// Signing is only half the gate now; the data-protection box is the other half.
function acknowledgePrivacy() {
  fireEvent.click(screen.getByRole('checkbox'))
}

function sign() {
  const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
  fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
  fireEvent.pointerUp(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
}

describe('Contract', () => {
  beforeEach(() => {
    installFakeCanvasContext()
    vi.spyOn(api, 'getContract').mockResolvedValue('Vertragstext hier.')
    vi.spyOn(api, 'getPrivacyText').mockResolvedValue('Datenschutzinformation hier.')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the contract text and enables "Weiter" only after a signature is drawn', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)

    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()

    sign()
    acknowledgePrivacy()

    expect(submit).toBeEnabled()

    fireEvent.click(submit)

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).toBe('data:image/png;base64,AAAA')
  })

  it('"Löschen" repaints the background and disables "Weiter" again', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const submit = screen.getByRole('button', { name: 'Weiter' })
    const clear = screen.getByRole('button', { name: 'Löschen' })

    sign()
    acknowledgePrivacy()
    expect(submit).toBeEnabled()

    fireEvent.click(clear)

    expect(submit).toBeDisabled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('keeps "Weiter" shut on a signature alone, without the data-protection box', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    sign()

    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()
    fireEvent.click(submit)
    expect(onNext).not.toHaveBeenCalled()
  })

  it('keeps "Weiter" shut on the box alone, without a signature', async () => {
    render(<Contract onNext={vi.fn()} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    acknowledgePrivacy()

    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('shows the full data-protection notice on request', async () => {
    render(<Contract onNext={vi.fn()} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    // Folded away by default: the guest has one contract to read, not two.
    expect(screen.queryByText('Datenschutzinformation hier.')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))

    expect(screen.getByText('Datenschutzinformation hier.')).toBeInTheDocument()
  })

  it('offers no box to tick when the notice could not be loaded', async () => {
    // Ticking a box that stands for nothing would be worse than not offering it.
    vi.spyOn(api, 'getPrivacyText').mockRejectedValue(new Error('offline'))
    render(<Contract onNext={vi.fn()} />)

    await waitFor(() =>
      screen.getByText(
        'Die Datenschutzinformation konnte nicht geladen werden. Bitte wende dich an das Personal.'
      )
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('shows a message when there is no contract text configured', async () => {
    vi.spyOn(api, 'getContract').mockResolvedValue('')
    render(<Contract onNext={vi.fn()} />)

    await waitFor(() =>
      screen.getByText('Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.')
    )
  })

  it('leaves the height to the stylesheet where nothing can be measured', async () => {
    // jsdom lays nothing out, which is exactly the case useContractCollapse has
    // to fall back from: no inline height, so `max-height: 40vh` still governs.
    render(<Contract onNext={vi.fn()} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const box = screen.getByRole('region', { name: 'Teilnahmebedingungen' })
    expect(box.style.height).toBe('')
    expect(document.querySelector('.contract-spacer')).not.toBeInTheDocument()
  })
})
