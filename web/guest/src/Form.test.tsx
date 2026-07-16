import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Form from './Form'

describe('Form', () => {
  it('disables "Weiter" until all required fields are filled with valid values', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Vorname'), 'Anna')
    await user.type(screen.getByLabelText('Nachname'), 'Muster')
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText('Alter'), '30')
    await user.type(screen.getByLabelText('Gewicht (kg)'), '70')
    await user.type(screen.getByLabelText('Adresse'), 'Hauptstraße 1, 4240 Freistadt')
    // invalid email should keep the button disabled
    await user.type(screen.getByLabelText('E-Mail'), 'not-an-email')
    await user.type(screen.getByLabelText('Telefon'), '0664 1234567')
    expect(submit).toBeDisabled()

    await user.clear(screen.getByLabelText('E-Mail'))
    await user.type(screen.getByLabelText('E-Mail'), 'anna@example.com')

    expect(submit).toBeEnabled()

    await user.click(submit)

    expect(onNext).toHaveBeenCalledWith({
      first_name: 'Anna',
      last_name: 'Muster',
      age: 30,
      weight_kg: 70,
      address: 'Hauptstraße 1, 4240 Freistadt',
      email: 'anna@example.com',
      phone: '0664 1234567',
    })
  })

  it('rejects out-of-range age and weight', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await user.type(screen.getByLabelText('Vorname'), 'Anna')
    await user.type(screen.getByLabelText('Nachname'), 'Muster')
    await user.type(screen.getByLabelText('Alter'), '150')
    await user.type(screen.getByLabelText('Gewicht (kg)'), '5')
    await user.type(screen.getByLabelText('Adresse'), 'Hauptstraße 1')
    await user.type(screen.getByLabelText('E-Mail'), 'anna@example.com')
    await user.type(screen.getByLabelText('Telefon'), '0664 1234567')

    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
    expect(onNext).not.toHaveBeenCalled()
  })
})
