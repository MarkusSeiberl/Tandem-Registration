// All API calls use ABSOLUTE root paths (e.g. fetch('/api/registrations')) so that
// they hit the Node server root, not the '/manifest' static prefix this app is served from.
// The optional apiBase (hidden operator setting) is prepended so the manifest PC can be
// pointed at a different server without a rebuild. Mirrors web/guest/src/api.ts.

import type { VoucherCheck } from './voucher'
export type { VoucherCheck } from './voucher'

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

export type Gender = 'male' | 'female' | 'diverse'
export type PaymentMethod = 'voucher' | 'cash' | 'card'
export type ExtraBooking = 'none' | 'video' | 'video_photo'
export type VoucherService = 'jump' | 'jump_video' | 'jump_video_photo'
// How a voucher guest paid the difference — a voucher itself moves no money.
export type CollectedVia = 'cash' | 'card'
export type WeightSurcharge = 'none' | 'over_90' | 'over_100'

export interface Prices {
  jump: number
  video: number
  video_photo: number
  weight_over_90: number
  weight_over_100: number
}

// Was der Verein pro Sprung an Tandemmaster und Kameraflieger auszahlt.
export interface Payouts {
  tandem_master: number
  video: number
  video_photo: number
}

export interface Registration {
  id: number
  first_name: string
  last_name: string
  gender: Gender | null
  age: number
  height_cm: number | null
  weight_kg: number
  street: string
  postal_code: string
  city: string
  email: string
  phone: string
  contract_pdf_filename: string | null
  accepted_terms: number
  tandem_master_id: number | null
  load_number: number | null
  price: number | null
  payment_method: PaymentMethod | null
  voucher_payment_method: CollectedVia | null
  voucher_number: string | null
  voucher_service: VoucherService | null
  // Ob der Gast die Preissteigerung seit dem Kauf des Gutscheins zahlt, und was
  // die Gutscheinliste als bezahlten Betrag ausweist.
  voucher_topup: number | null
  voucher_amount: number | null
  extra_booking: ExtraBooking | null
  weight_surcharge: WeightSurcharge | null
  price_override: number | null
  camera_flyer_id: number | null
  created_at: string
  jump_date: string
  // NULL heißt: noch nicht kassiert. Sonst der Zeitpunkt, den der Server gesetzt hat.
  paid_at: string | null
  // Freitext des Manifests zu Sondervereinbarungen.
  notes: string | null
  // Wann der Gast die Datenschutzinformation bestätigt hat. NULL bei Zeilen aus
  // der Zeit davor — das heißt nicht, dass jemand abgelehnt hätte.
  privacy_ack_at: string | null
  // Wann wir entschieden haben, dass der Gutschein eingelöst ist, und wann das
  // in der Gutscheinliste des Vereins angekommen ist.
  voucher_redeemed_at: string | null
  voucher_redeem_synced_at: string | null
}

export interface StammdatenItem {
  id: number
  name: string
}

export interface Settings {
  exportDir: string
  contractText: string
  privacyText: string
  jumpLocation: string
  backupDir: string
  voucherListPath: string
  prices: Prices
  payouts: Payouts
}

export interface ManifestPatch {
  tandem_master_id?: number | null
  load_number?: number | null
  // Only sent for a manual correction — otherwise the server derives the price
  // from the price table and `price_override: 0` hands control back to it.
  price?: number | null
  price_override?: 0 | 1
  payment_method?: PaymentMethod
  voucher_payment_method?: CollectedVia | null
  voucher_number?: string | null
  voucher_service?: VoucherService | null
  voucher_topup?: 0 | 1
  voucher_amount?: number | null
  extra_booking?: ExtraBooking
  weight_surcharge?: WeightSurcharge
  camera_flyer_id?: number | null
  // Ein Schalter, kein Zeitpunkt — den Zeitstempel setzt der Server.
  paid?: boolean
  notes?: string | null
}

export interface ExportResult {
  path: string
  count: number
  redemptionsWritten: number
  redemptionsPending: number
  redemptionsInvalid: number
}

export interface BackupResult {
  path: string
}

async function asJson<T>(res: Response): Promise<T> {
  return (await res.json()) as T
}

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string; errors?: string[] }
    return data.error ?? data.errors?.join(', ') ?? fallback
  } catch {
    return fallback
  }
}

export async function list(date: string): Promise<Registration[]> {
  const res = await fetch(apiUrl(`/api/registrations?date=${encodeURIComponent(date)}`))
  if (!res.ok) throw new Error('Registrierungen konnten nicht geladen werden')
  return asJson<Registration[]>(res)
}

export async function patch(id: number, fields: ManifestPatch): Promise<Registration> {
  const res = await fetch(apiUrl(`/api/registrations/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Speichern fehlgeschlagen'))
  return asJson<Registration>(res)
}

export async function remove(id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/registrations/${id}`), { method: 'DELETE' })
  if (!res.ok) throw new Error('Löschen fehlgeschlagen')
}

export async function checkVoucher(number: string): Promise<VoucherCheck> {
  const res = await fetch(apiUrl(`/api/voucher?number=${encodeURIComponent(number)}`))
  if (!res.ok) throw new Error('Gutschein konnte nicht geprüft werden')
  return asJson<VoucherCheck>(res)
}

type StammdatenKind = 'masters' | 'flyers'

async function listKind(kind: StammdatenKind): Promise<StammdatenItem[]> {
  const res = await fetch(apiUrl(`/api/${kind}`))
  if (!res.ok) throw new Error('Liste konnte nicht geladen werden')
  return asJson<StammdatenItem[]>(res)
}

async function addKind(kind: StammdatenKind, name: string): Promise<{ id: number }> {
  const res = await fetch(apiUrl(`/api/${kind}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Anlegen fehlgeschlagen'))
  return asJson<{ id: number }>(res)
}

async function removeKind(kind: StammdatenKind, id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/${kind}/${id}`), { method: 'DELETE' })
  if (!res.ok) throw new Error('Löschen fehlgeschlagen')
}

export const masters = () => listKind('masters')
export const addMaster = (name: string) => addKind('masters', name)
export const deleteMaster = (id: number) => removeKind('masters', id)

export const flyers = () => listKind('flyers')
export const addFlyer = (name: string) => addKind('flyers', name)
export const deleteFlyer = (id: number) => removeKind('flyers', id)

export async function getSettings(): Promise<Settings> {
  const res = await fetch(apiUrl('/api/settings'))
  if (!res.ok) throw new Error('Einstellungen konnten nicht geladen werden')
  return asJson<Settings>(res)
}

export async function putSettings(fields: Partial<Settings>): Promise<Settings> {
  const res = await fetch(apiUrl('/api/settings'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) throw new Error('Einstellungen konnten nicht gespeichert werden')
  return asJson<Settings>(res)
}

// What the operator is looking for, and what the server found at a path it was
// asked about. Both mirror src/server/routes/{pickPath,paths}.ts.
export type PickKind = 'directory' | 'excel-file'
export type PathState = 'ok' | 'missing' | 'wrong-type'
export type PathField = 'exportDir' | 'backupDir' | 'voucherListPath'
export type PathChecks = Partial<Record<PathField, PathState>>

// The dialog opens on the server's desktop, so the server decides whether this
// caller may have it. Any failure means "no picker" — the text field alone is a
// working screen, an error banner about a convenience feature is not.
export async function pickerAvailable(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/pick-path'))
    if (!res.ok) return false
    return (await asJson<{ available: boolean }>(res)).available === true
  } catch {
    return false
  }
}

// Resolves with null when the operator closed the dialog without choosing.
export async function pickPath(kind: PickKind, current: string): Promise<string | null> {
  const res = await fetch(apiUrl('/api/pick-path'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, current }),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Auswahl fehlgeschlagen'))
  return (await asJson<{ path: string | null }>(res)).path ?? null
}

// Advisory. A server that cannot answer simply produces no warnings.
export async function checkPaths(fields: Partial<Record<PathField, string>>): Promise<PathChecks> {
  try {
    const res = await fetch(apiUrl('/api/paths/check'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    if (!res.ok) return {}
    return asJson<PathChecks>(res)
  } catch {
    return {}
  }
}

export function contractPdfUrl(id: number): string {
  return apiUrl(`/api/registrations/${id}/contract.pdf`)
}

export async function exportDay(date: string): Promise<ExportResult> {
  const res = await fetch(apiUrl(`/api/export?date=${encodeURIComponent(date)}`), {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Export fehlgeschlagen'))
  return asJson<ExportResult>(res)
}

export async function createBackup(): Promise<BackupResult> {
  const res = await fetch(apiUrl('/api/backup'), { method: 'POST' })
  if (!res.ok) throw new Error(await errorMessage(res, 'Backup fehlgeschlagen'))
  return asJson<BackupResult>(res)
}

export async function pendingRedemptions(): Promise<{ count: number }> {
  const res = await fetch(apiUrl('/api/voucher/pending'))
  if (!res.ok) throw new Error('Offene Einlösungen konnten nicht geladen werden')
  return asJson<{ count: number }>(res)
}

// What one jump day runs on: the price list and payout rates frozen by that
// day's first registration, plus what the settings say right now, so a screen
// can tell the operator that the two have parted ways.
export interface DayTables {
  prices: Prices
  payouts: Payouts
  /** False for a day nobody has registered on yet — it is quoted, not settled. */
  frozen: boolean
  current: { prices: Prices; payouts: Payouts }
}

export async function dayTables(date: string): Promise<DayTables> {
  const res = await fetch(apiUrl(`/api/day-tables/${encodeURIComponent(date)}`))
  if (!res.ok) throw new Error(await errorMessage(res, 'Tagespreise konnten nicht geladen werden'))
  return asJson<DayTables>(res)
}

// Copies today's settings onto one day and re-prices its registrations, apart
// from those carrying a manual correction.
export async function repriceDay(date: string): Promise<{ updated: number }> {
  const res = await fetch(apiUrl(`/api/day-tables/${encodeURIComponent(date)}/reprice`), {
    method: 'POST',
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Preise übernehmen fehlgeschlagen'))
  return asJson<{ updated: number }>(res)
}
