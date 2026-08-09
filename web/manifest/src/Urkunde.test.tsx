import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Urkunde from './Urkunde'
import type { Registration } from './api'

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
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
    contract_pdf_filename: '2026.07.09_Muster-Anna.pdf',
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
    ...overrides,
  }
}

describe('Urkunde', () => {
  it('renders the guest full name and jump date', () => {
    const registration = makeRegistration()

    render(<Urkunde registration={registration} />)

    expect(screen.getByText('Anna Muster')).toBeInTheDocument()
    expect(screen.getByText('2026-07-09')).toBeInTheDocument()
  })

  it('is wrapped in the print-only region so it stays hidden on screen', () => {
    const registration = makeRegistration()

    const { container } = render(<Urkunde registration={registration} />)

    expect(container.querySelector('.print-only')).not.toBeNull()
  })
})
