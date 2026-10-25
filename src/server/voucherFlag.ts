import type { Database } from 'better-sqlite3'
import type { Config } from './config'
import { loadVoucherList, lookupVoucher } from './voucherList'
import type { VoucherList, VoucherStatus } from './voucherList'
import { computePrice } from './pricing'
import type { PricedFields } from './pricing'
import { tablesForDay } from './dayTables'

/**
 * What the manifest list marks with a ⚠: the verdict of the club's voucher list
 * on a row's number, stored on the row. `status` is null when there is nothing
 * to warn about.
 */
export interface VoucherFlag {
  status: Exclude<VoucherStatus, 'ok'> | null
  /** The redemption date (YYYY-MM-DD) or the cancellation text, for the tooltip. */
  detail: string | null
}

const NO_FLAG: VoucherFlag = { status: null, detail: null }
const NO_FLAG_ROW = { voucher_check_status: null, voucher_check_detail: null }

export function flagFor(list: VoucherList, number: string): VoucherFlag {
  const { status, entry } = lookupVoucher(list, number)
  if (status === 'ok') return NO_FLAG
  if (status === 'redeemed') {
    return { status, detail: entry?.redeemedAt?.toISOString().slice(0, 10) ?? null }
  }
  if (status === 'cancelled') return { status, detail: entry?.paidText ?? null }
  return { status, detail: null }
}

interface FlaggableRow {
  id: number
  voucher_number: string | null
  paid_at: string | null
  voucher_redeem_synced_at: string | null
  voucher_check_status: string | null
  voucher_check_detail: string | null
}

function store(db: Database, id: number, flag: VoucherFlag): void {
  db.prepare(`UPDATE registrations
    SET voucher_check_status=@status, voucher_check_detail=@detail WHERE id=@id`)
    .run({ id, ...flag })
}

/**
 * Prices an open row again from its day's table, now that the verdict it is
 * priced with may have changed: a rejected voucher takes nothing off the bill,
 * and a payment the club enters mid-day gives the deduction back. A manual
 * price and a collected row are left alone — the first is the operator's
 * word, the second is money already taken. Returns the price the row now has.
 */
function reprice(db: Database, cfg: Config, id: number): number | null {
  const row = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as
    (PricedFields & { price: number | null; price_override: number; paid_at: string | null;
      jump_date: string }) | undefined
  if (!row) return null
  if (row.price_override || row.paid_at) return row.price
  const price = computePrice(row, tablesForDay(db, row.jump_date, cfg).prices)
  if (price !== row.price) db.prepare('UPDATE registrations SET price=? WHERE id=?').run(price, id)
  return price
}

/**
 * Re-checks the rows whose verdict can still change and returns every row with
 * the verdict the list should show.
 *
 * A collected row keeps the verdict it was collected under, and so does a row
 * whose redemption already reached the file: once our own date is in the
 * club's list, a live check would call the voucher redeemed and flag the very
 * row that redeemed it.
 *
 * Best-effort like every other use of the club's list: an unreadable file
 * leaves the stored verdicts alone rather than clearing them.
 */
export async function refreshVoucherFlags<T extends FlaggableRow>(
  db: Database,
  cfg: Config,
  rows: T[],
  log?: (err: unknown) => void
): Promise<T[]> {
  const path = cfg.voucherListPath?.trim()
  const live = rows.filter((row) => row.voucher_number && !row.paid_at && !row.voucher_redeem_synced_at)
  // A club that switched the feature off must not keep seeing warnings from
  // the days it was on. Open rows also drop the stored verdict, since their
  // price is computed from it: a list nobody consults rejects nothing.
  if (!path) {
    return rows.map((row) => {
      if (live.includes(row) && row.voucher_check_status !== null) {
        store(db, row.id, NO_FLAG)
        return { ...row, ...NO_FLAG_ROW, price: reprice(db, cfg, row.id) }
      }
      return { ...row, ...NO_FLAG_ROW }
    })
  }
  if (live.length === 0) return rows

  let list: VoucherList
  try {
    list = await loadVoucherList(path)
  } catch (err) {
    log?.(err)
    return rows
  }

  return rows.map((row) => {
    if (!live.includes(row)) return row
    const flag = flagFor(list, row.voucher_number!)
    const verdict = { voucher_check_status: flag.status, voucher_check_detail: flag.detail }
    if (flag.status !== row.voucher_check_status || flag.detail !== row.voucher_check_detail) {
      store(db, row.id, flag)
      return { ...row, ...verdict, price: reprice(db, cfg, row.id) }
    }
    return { ...row, ...verdict }
  })
}

/**
 * Re-checks one row after the manifest changed its number or collected it.
 * Throws when the list cannot be read; the caller decides that is not fatal.
 */
export async function refreshVoucherFlag(
  db: Database,
  cfg: Config,
  id: number,
  number: string | null
): Promise<void> {
  const path = cfg.voucherListPath?.trim()
  store(db, id, !number || !path ? NO_FLAG : flagFor(await loadVoucherList(path), number))
  reprice(db, cfg, id)
}
