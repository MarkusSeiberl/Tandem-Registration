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

  it('sends the signature once the contract is signed and the notice accepted', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)

    await waitFor(() => screen.getByText('Vertragstext hier.'))

    sign()
    acknowledgePrivacy()
    fireEvent.click(screen.getByRole('button', { name: 'Anmeldung abschicken' }))

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).toBe('data:image/png;base64,AAAA')
  })

  it('marks the data-protection box when the guest sends without ticking it', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    sign()
    fireEvent.click(screen.getByRole('button', { name: 'Anmeldung abschicken' }))

    expect(onNext).not.toHaveBeenCalled()
    const box = screen.getByRole('checkbox')
    expect(box).toHaveAttribute('aria-invalid', 'true')
    expect(box).toHaveFocus()
    expect(
      screen.getByText('Bitte bestätige die Datenschutzinformation, um fortzufahren.')
    ).toBeInTheDocument()

    // Ticking it takes the mark away again — the guest fixed what was asked.
    acknowledgePrivacy()
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-invalid', 'false')
    expect(
      screen.queryByText('Bitte bestätige die Datenschutzinformation, um fortzufahren.')
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Anmeldung abschicken' }))
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('marks the signature pad when the guest sends without signing', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    acknowledgePrivacy()
    fireEvent.click(screen.getByRole('button', { name: 'Anmeldung abschicken' }))

    expect(onNext).not.toHaveBeenCalled()
    expect(screen.getByText('Bitte unterschreibe im Feld oben.')).toBeInTheDocument()
    expect(document.querySelector('canvas.signature-pad')).toHaveClass('missing')
  })

  it('"Unterschrift löschen" repaints the background and holds the send back again', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const clear = screen.getByRole('button', { name: 'Unterschrift löschen' })
    // Nothing drawn yet, nothing to clear.
    expect(clear).toBeDisabled()

    sign()
    acknowledgePrivacy()
    expect(clear).toBeEnabled()

    fireEvent.click(clear)
    fireEvent.click(screen.getByRole('button', { name: 'Anmeldung abschicken' }))

    expect(onNext).not.toHaveBeenCalled()
    expect(screen.getByText('Bitte unterschreibe im Feld oben.')).toBeInTheDocument()
  })

  it('offers a way back to the form, and only when there is one', async () => {
    const onBack = vi.fn()
    const { unmount } = render(<Contract onNext={vi.fn()} onBack={onBack} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }))
    expect(onBack).toHaveBeenCalledTimes(1)

    unmount()
    render(<Contract onNext={vi.fn()} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))
    expect(screen.queryByRole('button', { name: 'Zurück' })).not.toBeInTheDocument()
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
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)

    await waitFor(() =>
      screen.getByText(
        'Die Datenschutzinformation konnte nicht geladen werden. Bitte wende dich an das Personal.'
      )
    )
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()

    // Without a box to tick there is nothing to accept, so sending stays shut.
    sign()
    fireEvent.click(screen.getByRole('button', { name: 'Anmeldung abschicken' }))
    expect(onNext).not.toHaveBeenCalled()
  })

  it('marks the end of the contract for the read gate to watch', async () => {
    render(<Contract onNext={vi.fn()} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const marker = document.querySelector('.contract-end')
    expect(marker).toBeInTheDocument()
    // Inside the text, after it — a marker anywhere else would be reachable
    // without the contract having been scrolled through.
    expect(marker?.parentElement).toHaveClass('contract-text')
    expect(marker?.previousElementSibling?.textContent).toBe('Vertragstext hier.')
  })

  it('shows a message when there is no contract text configured', async () => {
    vi.spyOn(api, 'getContract').mockResolvedValue('')
    render(<Contract onNext={vi.fn()} />)

    await waitFor(() =>
      screen.getByText('Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.')
    )
  })
})
