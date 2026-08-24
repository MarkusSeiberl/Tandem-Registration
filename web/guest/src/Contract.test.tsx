import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('opens the data-protection notice over the screen, not inside it', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText('Vertragstext hier.')

    await user.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))

    const sheet = await screen.findByRole('dialog', { name: 'Datenschutzinformation' })
    expect(sheet).toHaveAttribute('aria-modal', 'true')
    expect(within(sheet).getByText('Datenschutzinformation hier.')).toBeInTheDocument()
  })

  it('closes the notice and leaves the box the guest already ticked alone', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText('Vertragstext hier.')

    const box = document.querySelector('.privacy-check input') as HTMLInputElement
    await user.click(box)
    expect(box.checked).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))
    const sheet = await screen.findByRole('dialog', { name: 'Datenschutzinformation' })
    await user.click(within(sheet).getByRole('button', { name: 'Datenschutzinformation zuklappen' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // Reading the notice must not undo the consent — the guest would have to
    // find and tick it a second time with no idea why.
    expect((document.querySelector('.privacy-check input') as HTMLInputElement).checked).toBe(true)
  })

  it('closes the notice on Escape', async () => {
    const user = userEvent.setup()
    render(<Contract onNext={() => {}} />)
    await screen.findByText('Vertragstext hier.')

    await user.click(screen.getByRole('button', { name: 'Datenschutzinformation lesen' }))
    await screen.findByRole('dialog', { name: 'Datenschutzinformation' })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the read gate shut until the contract has been scrolled to its end', async () => {
    render(<Contract onNext={() => {}} />)

    // jsdom reports every box as 0x0, so the "does it already fit?" effect has
    // to be defeated explicitly before the gate can be exercised at all — and
    // before the text arrives, because that effect runs the moment it does and
    // nothing ever closes the gate again once it has opened.
    const text = document.querySelector('.contract-text') as HTMLElement
    Object.defineProperty(text, 'scrollHeight', { value: 2000, configurable: true })
    Object.defineProperty(text, 'clientHeight', { value: 400, configurable: true })

    await screen.findByText('Vertragstext hier.')

    expect(screen.getByText(/Bitte den gesamten Vertrag lesen/)).toBeInTheDocument()

    fireEvent.scroll(text, { target: { scrollTop: 1600 } })

    expect(screen.queryByText(/Bitte den gesamten Vertrag lesen/)).not.toBeInTheDocument()
  })

  it('puts every action in the pinned band and the reading in the body', async () => {
    render(<Contract onNext={() => {}} onCancel={() => {}} />)
    await screen.findByText('Vertragstext hier.')

    const actions = within(document.querySelector('.screen-actions') as HTMLElement)
    expect(actions.getByRole('button', { name: 'Abbrechen' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Löschen' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Weiter' })).toBeInTheDocument()

    // The contract, the consent and the signature are one card in the body —
    // the band that is allowed to give when the keyboard takes the room.
    const body = document.querySelector('.screen-body') as HTMLElement
    expect(body.querySelector('.contract-text')).not.toBeNull()
    expect(body.querySelector('.privacy-check')).not.toBeNull()
    expect(body.querySelector('canvas.signature-pad')).not.toBeNull()
  })

  it('keeps the signature image at the size the contract PDF stamps', async () => {
    render(<Contract onNext={() => {}} />)
    await screen.findByText('Vertragstext hier.')

    // The pad is displayed at whatever width its column has, but the PNG that
    // goes to the server must not change size with it — src/server/contractPdf.ts
    // places it at fixed dimensions.
    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    expect(canvas.width).toBe(700)
    expect(canvas.height).toBe(280)
  })
})
