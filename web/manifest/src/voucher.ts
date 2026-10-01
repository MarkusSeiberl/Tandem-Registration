import type { VoucherService } from './api'

export type VoucherStatus =
  | 'ok' | 'not_found' | 'ambiguous' | 'unpaid' | 'cancelled' | 'redeemed'

/** Mirrors the response of GET /api/voucher (src/server/routes/voucher.ts). */
export interface VoucherCheck {
  configured: boolean
  readable: boolean
  status: VoucherStatus | null
  number: string | null
  paidAt: string | null
  paidText: string | null
  amount: number | null
  art: string | null
  service: VoucherService | null
  isAddOn: boolean
  redeemedAt: string | null
  error: string | null
}

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

export interface StatusLine {
  text: string
  tone: 'ok' | 'warn' | 'muted'
}

// One line, one job: say what the club's list knows about this number. A missing
// list is muted rather than a warning — the club that configured no file has
// nothing to fix.
export function voucherStatusText(check: VoucherCheck): StatusLine | null {
  if (!check.configured) return null
  if (!check.readable) {
    return { text: check.error ?? 'Gutscheinliste nicht lesbar.', tone: 'muted' }
  }
  if (check.status === 'ok') {
    return { text: `Bezahlt am ${formatDate(check.paidAt)}, noch nicht eingelöst.`, tone: 'ok' }
  }
  if (check.status === null) return null
  const detail = check.status === 'cancelled' ? check.paidText : check.redeemedAt
  return { text: voucherWarningText(check.status, detail), tone: 'warn' }
}

// Shared by the detail screen's status line and the ⚠ in the list, so the two
// never word the same verdict differently. `detail` is the cancellation text
// for 'cancelled' and the ISO redemption date for 'redeemed'.
export function voucherWarningText(
  status: Exclude<VoucherStatus, 'ok'>,
  detail: string | null
): string {
  switch (status) {
    case 'unpaid':
      return 'Nicht bezahlt — Gutschein ist nicht gültig.'
    case 'cancelled':
      return `Storniert („${detail ?? ''}").`
    case 'redeemed':
      return `Bereits eingelöst am ${formatDate(detail)}.`
    case 'ambiguous':
      return 'Mehrere Gutscheine passen zu dieser Nummer.'
    case 'not_found':
      return 'Nummer nicht in der Gutscheinliste.'
  }
}

// Separate from the status: what the voucher covers is a different question from
// whether it is valid, and both can be wrong at once. The Art is always said out
// loud once a number is known — it is the wording the guest bought, and reading
// it here beats opening the list — while the tone is what carries the mismatch.
export function voucherServiceText(
  check: VoucherCheck,
  chosen: VoucherService | ''
): StatusLine | null {
  if (!check.configured || !check.readable || !check.art) return null
  if (check.isAddOn) {
    return { text: `Laut Liste: ${check.art} — deckt keinen Sprung ab.`, tone: 'muted' }
  }
  // No mapping means nothing to compare against; better mute than wrong.
  const mismatch = !!check.service && chosen !== '' && check.service !== chosen
  return { text: `Laut Liste: ${check.art}.`, tone: mismatch ? 'warn' : 'muted' }
}

// Shown, never compared. Every voucher the club issued before the last price
// rise is below today's value — that is the arrangement, not a fault, so this
// line is plain information and carries no tone of alarm.
export function voucherAmountText(
  check: VoucherCheck,
  valueToday: number | null,
  formatEuro: (amount: number) => string
): StatusLine | null {
  if (!check.configured || !check.readable || check.amount === null) return null
  const today = valueToday === null ? '' : ` · ${formatEuro(valueToday)} heute`
  return { text: `${formatEuro(check.amount)} damals${today}`, tone: 'muted' }
}
