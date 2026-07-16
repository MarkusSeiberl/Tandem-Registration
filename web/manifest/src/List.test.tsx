import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import List from './List'
import * as api from './api'
import type { Registration } from './api'
import { today } from './date'

vi.mock('./api', () => ({
  list: vi.fn(),
  masters: vi.fn(),
  exportDay: vi.fn(),
  getApiBase: vi.fn(() => ''),
}))

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
    signature_png: '',
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: null,
    payment_method: null,
    voucher_number: null,
    extra_booking: null,
    camera_flyer_id: null,
    created_at: '2026-07-09T10:00:00.000Z',
    jump_date: '2026-07-09',
    ...overrides,
  }
}

describe('List', () => {
  beforeEach(() => {
    vi.mocked(api.masters).mockResolvedValue([])
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
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('defaults the date picker to today (YYYY-MM-DD)', async () => {
    vi.mocked(api.list).mockResolvedValue([])

    render(<List onSelect={() => {}} />)

    const dateInput = screen.getByLabelText('Datum') as HTMLInputElement
    expect(dateInput.value).toBe(today())
    await screen.findByText('Keine Registrierungen für dieses Datum.')
  })
})
