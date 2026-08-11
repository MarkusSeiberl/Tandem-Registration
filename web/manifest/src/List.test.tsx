import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import List from './List'
import * as api from './api'
import type { Registration } from './api'
import { today } from './date'

vi.mock('./api', () => ({
  list: vi.fn(),
  masters: vi.fn(),
  exportDay: vi.fn(),
  patch: vi.fn(),
  getApiBase: vi.fn(() => ''),
  pendingRedemptions: vi.fn(),
}))

const openTable = () => screen.getByRole('table', { name: /^Offen/ })
const paidTable = () => screen.getByRole('table', { name: /^Kassiert/ })

function makeRow(overrides: Partial<Registration>): Registration {
  return {
    id: 1,
    first_name: 'Anna',
    last_name: 'Muster',
    gender: 'female',
    age: 30,
    height_cm: 170,
    weight_kg: 70,
    street: 'Hauptstraße 1',
    postal_code: '5020',
    city: 'Salzburg',
    email: 'anna@example.com',
    phone: '0664 1234567',
    contract_pdf_filename: null,
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: null,
    payment_method: null,
    voucher_payment_method: null,
    voucher_number: null,
    voucher_service: null,
    extra_booking: null,
    weight_surcharge: 'none',
    price_override: 0,
    camera_flyer_id: null,
    created_at: '2026-07-09T10:00:00.000Z',
    jump_date: '2026-07-09',
    paid_at: null,
    notes: null,
    privacy_ack_at: '2026-07-09T09:59:00.000Z',
    voucher_redeemed_at: null,
    voucher_redeem_synced_at: null,
    ...overrides,
  }
}

describe('List', () => {
  beforeEach(() => {
    vi.mocked(api.masters).mockResolvedValue([])
    vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })
  })

  it('renders one table row per registration', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster' }),
      makeRow({ id: 2, first_name: 'Bruno', last_name: 'Beispiel' }),
    ])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Anna Muster')).toBeInTheDocument()
    expect(screen.getByText('Bruno Beispiel')).toBeInTheDocument()

    // header row + 2 data rows
    expect(within(openTable()).getAllByRole('row')).toHaveLength(3)
  })

  it('keeps uncollected tandems above and collected ones below', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, first_name: 'Offen', last_name: 'Gast' }),
      makeRow({ id: 2, first_name: 'Bezahlt', last_name: 'Gast', paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    render(<List onSelect={() => {}} />)

    await screen.findByText('Offen Gast')
    expect(within(openTable()).getByText('Offen Gast')).toBeInTheDocument()
    expect(within(openTable()).queryByText('Bezahlt Gast')).not.toBeInTheDocument()
    expect(within(paidTable()).getByText('Bezahlt Gast')).toBeInTheDocument()
  })

  it('counts each table in its own heading', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1 }),
      makeRow({ id: 2 }),
      makeRow({ id: 3, paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Offen (2)')).toBeInTheDocument()
    expect(screen.getByText('Kassiert (1)')).toBeInTheDocument()
  })

  it('moves a row down when it is marked as collected', async () => {
    const row = makeRow({ id: 1, first_name: 'Anna', last_name: 'Muster' })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })

    render(<List onSelect={() => {}} />)
    await screen.findByText('Anna Muster')

    await userEvent.click(within(openTable()).getByRole('button', { name: /kassiert/i }))

    expect(api.patch).toHaveBeenCalledWith(1, { paid: true })
    await waitFor(() => expect(within(paidTable()).getByText('Anna Muster')).toBeInTheDocument())
  })

  it('moves a row back up when the collection is undone', async () => {
    const row = makeRow({ id: 1, paid_at: '2026-07-09T12:00:00.000Z' })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: null })

    render(<List onSelect={() => {}} />)
    await screen.findByText('Anna Muster')

    await userEvent.click(within(paidTable()).getByRole('button', { name: 'Als offen markieren' }))

    expect(api.patch).toHaveBeenCalledWith(1, { paid: false })
    await waitFor(() => expect(within(openTable()).getByText('Anna Muster')).toBeInTheDocument())
  })

  it('does not open the detail screen when the collect button is used', async () => {
    const row = makeRow({ id: 1 })
    vi.mocked(api.list).mockResolvedValue([row])
    vi.mocked(api.patch).mockResolvedValue({ ...row, paid_at: '2026-07-09T12:00:00.000Z' })
    const onSelect = vi.fn()

    render(<List onSelect={onSelect} />)
    await screen.findByText('Anna Muster')

    await userEvent.click(within(openTable()).getByRole('button', { name: /kassiert/i }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('tells each table apart when one side is empty', async () => {
    vi.mocked(api.list).mockResolvedValue([makeRow({ id: 1 })])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Noch nichts kassiert.')).toBeInTheDocument()
    expect(screen.queryByText('Keine offenen Einträge.')).not.toBeInTheDocument()
  })

  it('shows the flown service and the weight surcharge', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ extra_booking: 'video_photo', weight_surcharge: 'over_100' }),
    ])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Sprung+Video+Foto')).toBeInTheDocument()
    expect(screen.getByText('ab 100 kg')).toBeInTheDocument()
  })

  it('does not repeat the voucher service beside the flown service', async () => {
    // A jump+video voucher upgraded to video+photo is ONE jump. Rendering the
    // voucher service too printed "Sprung+Video" next to "Sprung+Video+Foto",
    // which read like two bookings.
    vi.mocked(api.list).mockResolvedValue([
      makeRow({
        payment_method: 'voucher',
        voucher_service: 'jump_video',
        extra_booking: 'video_photo',
      }),
    ])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Sprung+Video+Foto')).toBeInTheDocument()
    expect(screen.queryByText('Sprung+Video')).not.toBeInTheDocument()
  })

  it('shows which till a voucher top-up was paid into', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ payment_method: 'voucher', voucher_payment_method: 'cash' }),
    ])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Gutschein')).toBeInTheDocument()
    expect(screen.getByText('Bar')).toBeInTheDocument()
  })

  it('shows no surcharge pill when none is set', async () => {
    vi.mocked(api.list).mockResolvedValue([makeRow({ weight_surcharge: 'none' })])

    render(<List onSelect={() => {}} />)

    await screen.findByText('Anna Muster')
    expect(screen.queryByText('ab 90 kg')).not.toBeInTheDocument()
    expect(screen.queryByText('kein Zuschlag')).not.toBeInTheDocument()
  })

  it('sums the day’s takings in the toolbar, split by what is still open', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, price: 410 }),
      makeRow({ id: 2, price: 100 }),
      // Not manifested yet — must not break the sum.
      makeRow({ id: 3, price: null }),
      makeRow({ id: 4, price: 270, paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    render(<List onSelect={() => {}} />)

    expect(await screen.findByText('Offen: 510 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert: 270 €')).toBeInTheDocument()
  })

  it('defaults the date picker to today (YYYY-MM-DD)', async () => {
    vi.mocked(api.list).mockResolvedValue([])

    render(<List onSelect={() => {}} />)

    const dateInput = screen.getByLabelText('Datum') as HTMLInputElement
    expect(dateInput.value).toBe(today())
    await screen.findByText('Keine Registrierungen für dieses Datum.')
  })

  it('says how many redemptions the club list is still missing', async () => {
    vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 2 })
    render(<List onSelect={vi.fn()} />)

    expect(await screen.findByText(/2 Einlösungen noch nicht/)).toBeInTheDocument()
  })
})
