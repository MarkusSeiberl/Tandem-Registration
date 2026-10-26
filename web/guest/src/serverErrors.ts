// The form fields a server-side rejection can point back to.
export type ServerField =
  | 'firstName'
  | 'lastName'
  | 'gender'
  | 'age'
  | 'height'
  | 'weight'
  | 'street'
  | 'postalCode'
  | 'city'
  | 'email'
  | 'phone'
  | 'voucherNumber'

export type ServerFieldErrors = Partial<Record<ServerField, string>>

// Every message from src/server/validation.ts validateGuest() starts with the
// field's own label ("E-Mail ungültig", "PLZ fehlt"), so the label is what ties
// a message back to its field. Longest first where one label begins another.
const PREFIXES: [string, ServerField][] = [
  ['Straße und Hausnummer', 'street'],
  ['Gutschein-Nr.', 'voucherNumber'],
  ['Geschlecht', 'gender'],
  ['Nachname', 'lastName'],
  ['Vorname', 'firstName'],
  ['Gewicht', 'weight'],
  ['Telefon', 'phone'],
  ['Wohnort', 'city'],
  ['E-Mail', 'email'],
  ['Alter', 'age'],
  ['Größe', 'height'],
  ['PLZ', 'postalCode'],
]

/**
 * Splits the server's error list into the ones a form field can fix and the
 * rest (no connection, signature, terms), which stay on the contract screen.
 */
export function splitServerErrors(errors: string[]): {
  fields: ServerFieldErrors
  other: string[]
} {
  const fields: ServerFieldErrors = {}
  const other: string[] = []
  for (const message of errors) {
    const match = PREFIXES.find(([label]) => message.startsWith(label))
    if (match) fields[match[1]] = message
    else other.push(message)
  }
  return { fields, other }
}
