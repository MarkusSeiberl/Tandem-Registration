import type { Registration } from '../api'
import { collectedVia } from '../pricing'

/** What step 1 of the closing dialog still asks about. */
export interface TandemGroups {
  /** Not collected yet, and money is owed. */
  open: Registration[]
  /** Collected, but nobody recorded which till the money went into. */
  noMethod: Registration[]
  /** Not collected yet, but a voucher covers it all: nothing changes hands. */
  freeVoucher: Registration[]
}

const owes = (r: Registration) => (r.price ?? 0) > 0

export function groupTandems(rows: Registration[]): TandemGroups {
  return {
    open: rows.filter((r) => r.paid_at == null && owes(r)),
    noMethod: rows.filter((r) => r.paid_at != null && collectedVia(r) === null && owes(r)),
    freeVoucher: rows.filter((r) => r.paid_at == null && !owes(r)),
  }
}

/** Every tandem not collected yet, whatever it costs. */
export function openCount(rows: Registration[]): number {
  return rows.filter((r) => r.paid_at == null).length
}

/**
 * What the tills should hold: the same sums the sheet writes as "Summe Bar" and
 * "Summe Karte", so the dialog and the paper cannot disagree.
 */
export function expectedTills(rows: Registration[]): { cash: number; card: number } {
  let cash = 0
  let card = 0
  for (const r of rows) {
    if (r.paid_at == null) continue
    const via = collectedVia(r)
    if (via === 'cash') cash += r.price ?? 0
    else if (via === 'card') card += r.price ?? 0
  }
  return { cash: cents(cash), card: cents(card) }
}

function cents(value: number): number {
  return Math.round(value * 100) / 100
}

// German grouping ("1.300,50"), plain ("1300,5") or a dot as the decimal mark
// ("1300.50", what a number pad on a desk keyboard types). A lone dot followed
// by exactly three digits is read as grouping, the way it is written here.
const GROUPED = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/
const COMMA = /^\d+(,\d{1,2})?$/
const DOT = /^\d+\.\d{1,2}$/

/**
 * Reads what the operator typed into a Gezählt field. Empty is "not counted"
 * (null); anything that is not an amount of euros and cents is 'invalid'.
 */
export function parseAmount(input: string): number | null | 'invalid' {
  const compact = input.replace(/\s/g, '')
  if (compact === '') return null
  let normalised: string
  if (GROUPED.test(compact)) normalised = compact.replace(/\./g, '').replace(',', '.')
  else if (COMMA.test(compact)) normalised = compact.replace(',', '.')
  else if (DOT.test(compact)) normalised = compact
  else return 'invalid'
  return cents(Number(normalised))
}

/**
 * What a Gezählt field keeps of a keystroke or a paste: digits, the decimal
 * comma and the grouping dot. Whether the result is a valid amount is
 * parseAmount's call; this only keeps letters and symbols out of the field.
 */
export function sanitizeAmountInput(raw: string): string {
  return raw.replace(/[^0-9.,]/g, '')
}

/** An amount the way the field shows it and parseAmount reads it back. */
export function formatAmountInput(value: number | null): string {
  if (value === null) return ''
  return value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true })
    .replace(/\s/g, '.')
}

/** Counted minus expected, in whole cents; null when the till was not counted. */
export function difference(counted: number | null, expected: number): number | null {
  if (counted === null) return null
  const diff = cents(counted - expected)
  return diff === 0 ? 0 : diff
}

/** Whether a counted till differs from what it should hold. */
export function needsReason(
  counted: { cash: number | null; card: number | null },
  expected: { cash: number; card: number },
): boolean {
  const off = (c: number | null, e: number) => c !== null && Math.abs(c - e) >= 0.005
  return off(counted.cash, expected.cash) || off(counted.card, expected.card)
}
