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

  it('rejects 139 cm and accepts the 140 cm minimum', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.clear(screen.getByLabelText('Größe (cm)'))
    await user.type(screen.getByLabelText('Größe (cm)'), '139')
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Größe (cm)'))
    await user.type(screen.getByLabelText('Größe (cm)'), '140')
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled()
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

// Which on-screen keyboard each field asks for. The guest holds a tablet, so a
// wrong keyboard is not a cosmetic detail: it is a field they cannot fill.
describe('Form keyboards', () => {
  it.each(['Alter', 'Größe (cm)', 'Gewicht (kg)'])(
    'asks for the dial pad on %s',
    (label) => {
      render(<Form onNext={vi.fn()} />)
      expect(screen.getByLabelText(label)).toHaveAttribute('inputmode', 'tel')
    },
  )

  // The server accepts non-numeric postal codes on purpose (see the note in
  // src/server/validation.ts), so a digits-only pad would lock out exactly the
  // guests that rule exists for.
  it('leaves PLZ on the normal keyboard so a UK code can be typed', () => {
    render(<Form onNext={vi.fn()} />)
    expect(screen.getByLabelText('PLZ')).not.toHaveAttribute('inputmode')
  })

  it('keeps the telephone keyboard on Telefon', () => {
    render(<Form onNext={vi.fn()} />)
    expect(screen.getByLabelText('Telefon')).toHaveAttribute('type', 'tel')
  })
})

// Field-to-field navigation. The form is filled in on a tablet with no Tab key,
// so the cursor has to be movable by Enter and by the two arrow buttons.
describe('Form field navigation', () => {
  it('moves the cursor to the next field on Enter instead of submitting', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await user.click(screen.getByLabelText('Vorname'))
    await user.keyboard('{Enter}')

    expect(screen.getByLabelText('Nachname')).toHaveFocus()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('lands on the gender group on the way from Nachname to Alter', async () => {
    const user = userEvent.setup()
    render(<Form onNext={vi.fn()} />)

    await user.click(screen.getByLabelText('Nachname'))
    await user.keyboard('{Enter}')

    const radios = screen.getAllByRole('radio')
    expect(radios.some((r) => r === document.activeElement)).toBe(true)
  })

  it('moves on from the gender group on Enter without submitting the form', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await user.click(screen.getByRole('radio', { name: 'weiblich' }))
    await user.keyboard('{Enter}')

    expect(screen.getByLabelText('Alter')).toHaveFocus()
    expect(onNext).not.toHaveBeenCalled()
    // The radios sit inside the form, so an unhandled Enter would submit and
    // paint every error message at once.
    expect(screen.queryByText('Vorname fehlt')).not.toBeInTheDocument()
  })

  it('moves the cursor with the arrow buttons in both directions', async () => {
    const user = userEvent.setup()
    render(<Form onNext={vi.fn()} />)

    await user.click(screen.getByLabelText('Vorname'))
    await user.click(screen.getByRole('button', { name: 'Nächstes Feld' }))
    expect(screen.getByLabelText('Nachname')).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Vorheriges Feld' }))
    expect(screen.getByLabelText('Vorname')).toHaveFocus()
  })

  it('disables the arrows at each end of the chain', async () => {
    const user = userEvent.setup()
    render(<Form onNext={vi.fn()} />)

    await user.click(screen.getByLabelText('Vorname'))
    expect(screen.getByRole('button', { name: 'Vorheriges Feld' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Nächstes Feld' })).toBeEnabled()

    await user.click(screen.getByLabelText('Telefon'))
    expect(screen.getByRole('button', { name: 'Nächstes Feld' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Vorheriges Feld' })).toBeEnabled()
  })

  it('submits on Enter in the last field once everything is valid', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.click(screen.getByLabelText('Telefon'))
    await user.keyboard('{Enter}')

    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('jumps to the first field in error on Enter in the last field', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    // Two holes; the guest must be sent to the earlier one, not the later.
    await user.clear(screen.getByLabelText('Wohnort'))
    await user.clear(screen.getByLabelText('Alter'))

    await user.click(screen.getByLabelText('Telefon'))
    await user.keyboard('{Enter}')

    expect(onNext).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Alter')).toHaveFocus()
    expect(screen.getByText('Alter ungültig (1–120)')).toBeInTheDocument()
  })

  it('comes back filled in when the guest returns from the contract', async () => {
    const onNext = vi.fn()
    render(
      <Form
        onNext={onNext}
        initialValues={{
          first_name: 'Max',
          last_name: 'Mustermann',
          gender: 'male',
          age: 30,
          height_cm: 182,
          weight_kg: 85,
          street: 'Musterstraße 1',
          postal_code: '4240',
          city: 'Freistadt',
          email: 'max@example.at',
          phone: '0660123456',
        }}
      />
    )

    expect(screen.getByLabelText('Vorname')).toHaveValue('Max')
    expect(screen.getByLabelText('Alter')).toHaveValue(30)
    expect(screen.getByLabelText('PLZ')).toHaveValue('4240')
    expect(screen.getByRole('radio', { name: 'männlich' })).toBeChecked()

    // Filled means valid: the guest can go straight back on without retyping.
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled()
    await userEvent.click(screen.getByRole('button', { name: 'Weiter' }))
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0].first_name).toBe('Max')
  })
})
