import { describe, expect, it } from 'vitest'
import { splitServerErrors } from './serverErrors'

describe('splitServerErrors', () => {
  it('ties field messages to their fields and keeps the rest apart', () => {
    const { fields, other } = splitServerErrors([
      'E-Mail ungültig',
      'Straße und Hausnummer fehlt',
      'Gutschein-Nr. ungültig',
      'Unterschrift fehlt',
      'Keine Verbindung zum Server. Bitte erneut versuchen.',
    ])

    expect(fields).toEqual({
      email: 'E-Mail ungültig',
      street: 'Straße und Hausnummer fehlt',
      voucherNumber: 'Gutschein-Nr. ungültig',
    })
    expect(other).toEqual([
      'Unterschrift fehlt',
      'Keine Verbindung zum Server. Bitte erneut versuchen.',
    ])
  })

  it('tells Vorname and Nachname apart', () => {
    expect(splitServerErrors(['Nachname fehlt']).fields).toEqual({ lastName: 'Nachname fehlt' })
  })
})
