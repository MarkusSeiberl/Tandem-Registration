import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Form from './Form'

// Fills everything except the field under test, so each case can prove that the
// one remaining field is what keeps "Weiter" disabled.
async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Vorname'), 'Anna')
  await user.type(screen.getByLabelText('Nachname'), 'Muster')
  await user.click(screen.getByRole('radio', { name: 'weiblich' }))
  await user.type(screen.getByLabelText('Alter'), '30')
  await user.type(screen.getByLabelText('Größe (cm)'), '170')
  await user.type(screen.getByLabelText('Gewicht (kg)'), '70')
  await user.type(screen.getByLabelText('Straße und Hausnummer'), 'Hauptstraße 1')
  await user.type(screen.getByLabelText('PLZ'), '4240')
  await user.type(screen.getByLabelText('Wohnort'), 'Freistadt')
  await user.type(screen.getByLabelText('E-Mail'), 'anna@example.com')
  await user.type(screen.getByLabelText('Telefon'), '0664 1234567')
}

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

    await user.click(screen.getByRole('radio', { name: 'weiblich' }))
    await user.type(screen.getByLabelText('Alter'), '30')
    await user.type(screen.getByLabelText('Größe (cm)'), '170')
    await user.type(screen.getByLabelText('Gewicht (kg)'), '70')
    await user.type(screen.getByLabelText('Straße und Hausnummer'), 'Hauptstraße 1')
    await user.type(screen.getByLabelText('PLZ'), '4240')
    await user.type(screen.getByLabelText('Wohnort'), 'Freistadt')
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
      gender: 'female',
      age: 30,
      height_cm: 170,
      weight_kg: 70,
      street: 'Hauptstraße 1',
      postal_code: '4240',
      city: 'Freistadt',
      email: 'anna@example.com',
      phone: '0664 1234567',
    })
  })

  it('rejects out-of-range age and weight', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.clear(screen.getByLabelText('Alter'))
    await user.type(screen.getByLabelText('Alter'), '150')
    await user.clear(screen.getByLabelText('Gewicht (kg)'))
    await user.type(screen.getByLabelText('Gewicht (kg)'), '5')

    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range Größe', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.clear(screen.getByLabelText('Größe (cm)'))
    await user.type(screen.getByLabelText('Größe (cm)'), '95')

    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('requires a gender to be chosen', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    // Everything except gender — so gender alone is what holds the button back.
    await user.type(screen.getByLabelText('Vorname'), 'Anna')
    await user.type(screen.getByLabelText('Nachname'), 'Muster')
    await user.type(screen.getByLabelText('Alter'), '30')
    await user.type(screen.getByLabelText('Größe (cm)'), '170')
    await user.type(screen.getByLabelText('Gewicht (kg)'), '70')
    await user.type(screen.getByLabelText('Straße und Hausnummer'), 'Hauptstraße 1')
    await user.type(screen.getByLabelText('PLZ'), '4240')
    await user.type(screen.getByLabelText('Wohnort'), 'Freistadt')
    await user.type(screen.getByLabelText('E-Mail'), 'anna@example.com')
    await user.type(screen.getByLabelText('Telefon'), '0664 1234567')

    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()

    // Choosing one — and only that — releases it.
    await user.click(screen.getByRole('radio', { name: 'divers' }))
    expect(submit).toBeEnabled()

    await user.click(submit)
    expect(onNext).toHaveBeenCalledWith(expect.objectContaining({ gender: 'diverse' }))
  })

  // The labels of every text/number input, in the order the guest meets them.
  const TEXT_FIELDS = [
    'Vorname', 'Nachname', 'Alter', 'Größe (cm)', 'Gewicht (kg)',
    'Straße und Hausnummer', 'PLZ', 'Wohnort', 'E-Mail', 'Telefon',
  ]

  it('marks every field as required, including the gender group', async () => {
    render(<Form onNext={vi.fn()} />)

    for (const label of TEXT_FIELDS) {
      const input = screen.getByLabelText(label)
      expect(input, `${label} ist nicht als Pflichtfeld ausgezeichnet`).toBeRequired()
    }
    // The radio group carries the marker itself; the individual radios cannot.
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-required', 'true')
    expect(screen.getByText('Alle Felder sind Pflichtfelder.')).toBeInTheDocument()
  })

  // Guards against a field being added to the form without a validation rule:
  // emptying any single one of them has to be enough to shut the button. One
  // case per field, so a new field that slips through names itself in the report.
  it.each(TEXT_FIELDS)('holds "Weiter" back when %s is empty', async (label) => {
    const user = userEvent.setup()
    render(<Form onNext={vi.fn()} />)

    await fillValid(user)
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled()

    await user.clear(screen.getByLabelText(label))
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()
  })

  it('flags a field the guest left empty', async () => {
    const user = userEvent.setup()
    render(<Form onNext={vi.fn()} />)

    const input = screen.getByLabelText('Vorname')
    expect(input).not.toHaveAttribute('aria-invalid')

    await user.click(input)
    await user.tab()

    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Vorname fehlt')).toBeInTheDocument()
  })

  it('accepts a non-numeric foreign postal code', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.clear(screen.getByLabelText('PLZ'))
    await user.type(screen.getByLabelText('PLZ'), 'SW1A 1AA')

    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled()
  })
})
