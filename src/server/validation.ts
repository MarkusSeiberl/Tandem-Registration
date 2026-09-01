export type Gender = 'male' | 'female' | 'diverse'
export const GENDERS: Gender[] = ['male', 'female', 'diverse']

export interface GuestInput {
  first_name: string; last_name: string; gender: Gender
  age: number; height_cm: number; weight_kg: number
  street: string; postal_code: string; city: string
  email: string; phone: string
  signature_png: string; accepted_terms: true; privacy_ack: true
}
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function validateGuest(input: any):
  { ok: true; value: GuestInput } | { ok: false; errors: string[] } {
  const e: string[] = []
  const s = (v: any) => typeof v === 'string' && v.trim().length > 0
  const int = (v: any, lo: number, hi: number) =>
    Number.isInteger(v) && v >= lo && v <= hi
  if (!s(input?.first_name)) e.push('Vorname fehlt')
  if (!s(input?.last_name)) e.push('Nachname fehlt')
  if (!GENDERS.includes(input?.gender)) e.push('Geschlecht fehlt')
  if (!int(input?.age, 1, 120)) e.push('Alter ungültig')
  if (!int(input?.height_cm, 140, 220)) e.push('Größe ungültig')
  if (!int(input?.weight_kg, 20, 200)) e.push('Gewicht ungültig')
  if (!s(input?.street)) e.push('Straße und Hausnummer fehlt')
  // Deliberately only a presence check: guests from outside AT bring 5-digit (DE)
  // or non-numeric (UK) codes, so any digit-count rule would reject real customers.
  if (!s(input?.postal_code)) e.push('PLZ fehlt')
  if (!s(input?.city)) e.push('Wohnort fehlt')
  if (!EMAIL.test(input?.email ?? '')) e.push('E-Mail ungültig')
  if (!s(input?.phone)) e.push('Telefon fehlt')
  if (typeof input?.signature_png !== 'string' ||
      !input.signature_png.startsWith('data:image/png')) e.push('Unterschrift fehlt')
  if (input?.accepted_terms !== true) e.push('Bedingungen nicht akzeptiert')
  // Separate from accepted_terms on purpose: bundling the data-protection notice
  // into the contract acceptance is exactly the packaging Art. 7(2) DSGVO does
  // not recognise, so the guest has to tick it as its own act.
  if (input?.privacy_ack !== true) e.push('Datenschutzinformation nicht bestätigt')
  return e.length ? { ok: false, errors: e } : { ok: true, value: input as GuestInput }
}
