export interface GuestInput {
  first_name: string; last_name: string; age: number; weight_kg: number
  address: string; email: string; phone: string
  signature_png: string; accepted_terms: true
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
  if (!int(input?.age, 1, 120)) e.push('Alter ungültig')
  if (!int(input?.weight_kg, 20, 200)) e.push('Gewicht ungültig')
  if (!s(input?.address)) e.push('Adresse fehlt')
  if (!EMAIL.test(input?.email ?? '')) e.push('E-Mail ungültig')
  if (!s(input?.phone)) e.push('Telefon fehlt')
  if (typeof input?.signature_png !== 'string' ||
      !input.signature_png.startsWith('data:image/png')) e.push('Unterschrift fehlt')
  if (input?.accepted_terms !== true) e.push('Bedingungen nicht akzeptiert')
  return e.length ? { ok: false, errors: e } : { ok: true, value: input as GuestInput }
}
