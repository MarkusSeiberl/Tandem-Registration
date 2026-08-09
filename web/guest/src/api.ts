// All API calls use ABSOLUTE root paths (e.g. fetch('/api/registrations')) so that
// they hit the Node server root, not the '/guest' static prefix this app is served from.
// The optional apiBase (hidden operator setting) is prepended so the tablet can be
// pointed at a different server (e.g. http://192.168.1.10:3000) without a rebuild.

const API_BASE_KEY = 'apiBase'

export function getApiBase(): string {
  try {
    return window.localStorage.getItem(API_BASE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setApiBase(base: string): void {
  try {
    if (base.trim() === '') {
      window.localStorage.removeItem(API_BASE_KEY)
    } else {
      window.localStorage.setItem(API_BASE_KEY, base.trim())
    }
  } catch {
    // ignore storage errors (e.g. private mode)
  }
}

function apiUrl(rootPath: string): string {
  return `${getApiBase()}${rootPath}`
}

export async function getContract(): Promise<string> {
  const res = await fetch(apiUrl('/api/contract'))
  if (!res.ok) throw new Error('Vertragstext konnte nicht geladen werden')
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}

export async function getPrivacyText(): Promise<string> {
  const res = await fetch(apiUrl('/api/privacy'))
  if (!res.ok) throw new Error('Datenschutzinformation konnte nicht geladen werden')
  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}

export interface RegistrationPayload {
  first_name: string
  last_name: string
  gender: 'male' | 'female' | 'diverse'
  age: number
  height_cm: number
  weight_kg: number
  street: string
  postal_code: string
  city: string
  email: string
  phone: string
  signature_png: string
  accepted_terms: true
  // The guest's acknowledgement of the data-protection notice, kept apart from
  // accepted_terms: one covers the contract, the other the Art. 13 information.
  privacy_ack: true
}

export type SubmitResult =
  | { ok: true; id: number }
  | { ok: false; errors: string[] }

export async function submitRegistration(payload: RegistrationPayload): Promise<SubmitResult> {
  let res: Response
  try {
    res = await fetch(apiUrl('/api/registrations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    return { ok: false, errors: ['Keine Verbindung zum Server. Bitte erneut versuchen.'] }
  }

  if (res.status === 201) {
    const data = (await res.json()) as { id: number }
    return { ok: true, id: data.id }
  }
  if (res.status === 400) {
    const data = (await res.json()) as { errors?: string[] }
    return { ok: false, errors: data.errors ?? ['Unbekannter Fehler'] }
  }
  return { ok: false, errors: ['Server-Fehler. Bitte erneut versuchen.'] }
}
