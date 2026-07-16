import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import Print from './Print'
import type { Registration } from './api'

function makeRegistration(overrides: Partial<Registration> = {}): Registration {
  return {
    id: 1,
    first_name: 'Anna',
    last_name: 'Muster',
    age: 30,
    weight_kg: 70,
    address: 'Hauptstraße 1',
    email: 'anna@example.com',
    phone: '0664 1234567',
    signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
    accepted_terms: 1,
    tandem_master_id: null,
    load_number: null,
    price: null,
    payment_method: null,
    extra_booking: null,
    camera_flyer_id: null,
    created_at: '2026-07-09T10:00:00.000Z',
    jump_date: '2026-07-09',
    ...overrides,
  }
}

describe('Print', () => {
  it('renders the guest full name, jump date, and signature image', () => {
    const registration = makeRegistration()

    render(<Print registration={registration} />)

    expect(screen.getByText('Anna Muster')).toBeInTheDocument()
    expect(screen.getByText('2026-07-09')).toBeInTheDocument()

    const img = screen.getByRole('img', { name: 'Unterschrift' }) as HTMLImageElement
    expect(img.src).toBe(registration.signature_png)
  })

  it('is wrapped in the print-only region so it stays hidden on screen', () => {
    const registration = makeRegistration()

    const { container } = render(<Print registration={registration} />)

    expect(container.querySelector('.print-only')).not.toBeNull()
  })
})
