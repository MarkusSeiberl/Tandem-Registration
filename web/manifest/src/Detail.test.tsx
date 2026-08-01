import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Detail from './Detail'
import * as api from './api'
import type { Registration } from './api'

vi.mock('./api', () => ({
  patch: vi.fn(),
  masters: vi.fn(),
  flyers: vi.fn(),
  getSettings: vi.fn(),
  contractPdfUrl: vi.fn(() => '/api/registrations/1/contract.pdf'),
  getApiBase: vi.fn(() => ''),
}))

const PRICES = {
  jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60,
}

const PAYOUTS = { tandem_master: 45, video: 60, video_photo: 80 }

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    first_name: 'Anna',
    last_name: 'Muster',
    gender: 'female',
    age: 30,
    height_cm: 170,
    weight_kg: 95,
    street: 'Hauptstraße 1',
    postal_code: '5020',
    city: 'Salzburg',
    email: 'anna@example.com',
    phone: '0664 1234567',
    contract_pdf_filename: null,
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: 270,
    payment_method: null,
    voucher_payment_method: null,
    voucher_number: null,
    voucher_service: null,
    extra_booking: 'none',
    weight_surcharge: 'none',
    price_override: 0,
    camera_flyer_id: null,
    created_at: '2026-07-09T10:00:00.000Z',
    jump_date: '2026-07-09',
    paid_at: null,
    ...overrides,
  }
}

// The breakdown repeats the same amount as the total whenever there is only one
// line, so the total is read from its own row rather than by text alone.
function total(): string {
  return document.querySelector('.price-total .numeral')?.textContent ?? ''
}

function renderDetail(registration = makeRegistration()) {
  const onSaved = vi.fn()
  render(<Detail registration={registration} onBack={() => {}} onSaved={onSaved} />)
  return { onSaved }
}

describe('Detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter' }])
    vi.mocked(api.getSettings).mockResolvedValue({
      exportDir: '', contractText: '', jumpLocation: '', backupDir: '',
      prices: PRICES, payouts: PAYOUTS,
    })
    vi.mocked(api.patch).mockImplementation(async (_id, fields) =>
      makeRegistration(fields as Partial<Registration>))
  })

  it('shows the jump price for a guest with nothing selected', async () => {
    renderDetail()
    expect(await screen.findByText('Zu kassieren')).toBeInTheDocument()
    expect(total()).toBe('270 €')
  })

  it('adds the extra and the weight surcharge to the total', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')
    await user.selectOptions(screen.getByLabelText(/Gewichtszuschlag/), 'over_90')

    expect(total()).toBe('410 €')
  })

  it('charges a voucher guest the difference to what the voucher covers', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')

    expect(total()).toBe('100 €')
  })

  it('charges only the upgrade when a jump+video voucher becomes video+photo', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video_photo')

    expect(total()).toBe('20 €')
  })

  it('costs nothing when the voucher is used exactly as issued', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    // Picking the voucher raises the booking to what it covers, so the guest
    // is not charged for a jump the voucher already paid for.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')

    expect((screen.getByLabelText(/Gebuchte Leistung/) as HTMLSelectElement).value).toBe('video')
    expect(total()).toBe('0 €')
  })

  it('charges a voucher guest the weight surcharge, which no voucher covers', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gewichtszuschlag/), 'over_100')

    expect(total()).toBe('60 €')
  })

  it('shows the voucher as a deduction line in the breakdown', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video_photo')

    // Scoped to the breakdown: 'Gutschein' is also a Zahlungsart option label.
    const breakdown = document.querySelector('.price-breakdown')!
    expect(breakdown.textContent).toContain('Gutschein')
    expect(breakdown.textContent).toContain('-370 €')
  })

  it('asks how a voucher top-up was paid, and sends it', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    expect(screen.queryByLabelText(/Zuzahlung bezahlt mit/)).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')
    await user.selectOptions(screen.getByLabelText(/Gebuchte Leistung/), 'video')

    // 100 € owed on top of the voucher, so the till matters now.
    await user.selectOptions(screen.getByLabelText(/Zuzahlung bezahlt mit/), 'cash')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      payment_method: 'voucher',
      voucher_payment_method: 'cash',
    })
  })

  it('does not ask for a till when the voucher covers everything', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')

    // Nothing to collect — no money changes hands, so no till to record.
    expect(total()).toBe('0 €')
    expect(screen.queryByLabelText(/Zuzahlung bezahlt mit/)).not.toBeInTheDocument()
  })

  it('clears a stale till when the top-up disappears', async () => {
    const user = userEvent.setup()
    renderDetail(makeRegistration({
      payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'video',
      voucher_payment_method: 'cash',
    }))
    await screen.findByText('Zu kassieren')

    // Correcting the voucher to cover the video leaves nothing to collect.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      voucher_payment_method: null,
    })
  })

  it('offers the voucher service only when paying by voucher', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    expect(screen.queryByLabelText(/Gutschein-Leistung/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    expect(screen.getByLabelText(/Gutschein-Leistung/)).toBeInTheDocument()
  })

  it('asks for a Kameraflieger when only the voucher covers the video', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    // Nothing booked on top — the video still gets filmed, so a flyer is needed.
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump_video')

    expect(await screen.findByLabelText('Kameraflieger')).toBeInTheDocument()
  })

  it('hides the Kameraflieger when no video is involved at all', async () => {
    renderDetail()
    await screen.findByText('Zu kassieren')
    expect(screen.queryByLabelText('Kameraflieger')).not.toBeInTheDocument()
  })

  it('shows the entered weight as a hint without deriving the surcharge from it', async () => {
    renderDetail(makeRegistration({ weight_kg: 104 }))
    await screen.findByText('Zu kassieren')

    expect(screen.getByText('Eingetragenes Gewicht: 104 kg')).toBeInTheDocument()
    const select = screen.getByLabelText(/Gewichtszuschlag/) as HTMLSelectElement
    expect(select.value).toBe('none')
  })

  it('lets the manifest type an exception price', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.click(screen.getByLabelText('abweichender Preis'))
    const input = screen.getByLabelText('Preis (EUR)') as HTMLInputElement
    // Prefilled from the computed amount so a small correction is a small edit.
    expect(input.value).toBe('270')

    await user.clear(input)
    await user.type(input, '250')
    expect(total()).toBe('250 €')
  })

  it('sends the typed price, and otherwise leaves the price to the server', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText(/Gewichtszuschlag/), 'over_90')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      weight_surcharge: 'over_90',
      price_override: 0,
    })
    expect(vi.mocked(api.patch).mock.calls[0][1]).not.toHaveProperty('price')

    await user.click(screen.getByLabelText('abweichender Preis'))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({ price: 310 })
  })

  it('clears the voucher service when the guest no longer pays by voucher', async () => {
    const user = userEvent.setup()
    renderDetail(makeRegistration({ payment_method: 'voucher', voucher_service: 'jump' }))
    await screen.findByText('Zu kassieren')

    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'cash')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({
      payment_method: 'cash',
      voucher_service: null,
      voucher_number: null,
    })
  })
})
