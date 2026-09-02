import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { loadVoucherList, lookupVoucher } from '../voucherList'
import type { VoucherEntry, VoucherStatus } from '../voucherList'
import type { Config } from '../config'

export interface VoucherCheck {
  configured: boolean
  readable: boolean
  status: VoucherStatus | null
  number: string | null
  paidAt: string | null
  paidText: string | null
  amount: number | null
  art: string | null
  service: VoucherEntry['service']
  isAddOn: boolean
  redeemedAt: string | null
  error: string | null
}

const OFF: VoucherCheck = {
  configured: false, readable: false, status: null, number: null,
  paidAt: null, paidText: null, amount: null, art: null,
  service: null, isAddOn: false, redeemedAt: null, error: null,
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

// Every failure here is reported as data, never as a status code the manifest
// would have to treat as broken: an unreadable voucher list is a message beside
// a field, not a reason to stop taking registrations.
//
// The catch below is deliberately broad — it also swallows programming errors
// that have nothing to do with the club's file, not just the file-open failure
// readVoucherList guards on its own. Narrowing it would risk a bug turning into
// a 500 on a jump day, so it stays broad on purpose; `log` exists so a genuine
// bug still leaves a trace somewhere instead of only reaching the operator as
// "Gutscheinliste nicht lesbar".
export async function checkVoucher(
  cfg: Config,
  number: string,
  log?: (err: unknown) => void
): Promise<VoucherCheck> {
  const path = cfg.voucherListPath?.trim()
  if (!path) return { ...OFF }

  let list
  try {
    list = await loadVoucherList(path)
  } catch (err) {
    log?.(err)
    return {
      ...OFF,
      configured: true,
      error: err instanceof Error ? err.message : 'Gutscheinliste nicht lesbar.',
    }
  }

  const { status, entry } = lookupVoucher(list, number)
  return {
    configured: true,
    readable: true,
    status,
    number: entry?.number ?? null,
    paidAt: isoDate(entry?.paidAt ?? null),
    paidText: entry?.paidText ?? null,
    amount: entry?.amount ?? null,
    art: entry?.art ?? null,
    service: entry?.service ?? null,
    isAddOn: entry?.isAddOn ?? false,
    redeemedAt: isoDate(entry?.redeemedAt ?? null),
    error: null,
  }
}

export function registerVoucherRoutes(
  app: FastifyInstance,
  db: Database,
  cfgRef: { current: Config }
) {
  app.get('/api/voucher', async (req, reply) => {
    const number = (req.query as any)?.number
    if (typeof number !== 'string' || number.trim().length === 0) {
      return reply.code(400).send({ error: 'Gutschein-Nr. fehlt' })
    }
    return reply.send(
      await checkVoucher(cfgRef.current, number, (err) =>
        app.log.error({ err }, 'Gutscheinliste konnte nicht gelesen werden')
      )
    )
  })

  // What the manifest banner counts: redemptions we recorded that the club's
  // file has not received — every collected voucher row until the next export,
  // since nothing but the export writes into the file. A voucher the list
  // rejects sits in here too, until that export takes the redemption back.
  //
  // The predicate is word for word the export sweep's queue (routes/export.ts).
  // The two used to differ, and each difference was a row the banner counted
  // that no export could ever write off: `voucher_number IS NOT NULL` excludes
  // the row whose payment method was corrected away from Gutschein, which
  // clears the number and leaves the redemption behind with nothing to write.
  app.get('/api/voucher/pending', async () => {
    // An empty path is how a club switches the feature off. Without this the
    // banner would keep counting rows from the days the feature was in use,
    // while every redemption attempt returns 'disabled' — a warning that can
    // never be acted on and never goes away.
    if (!cfgRef.current.voucherListPath?.trim()) return { count: 0 }
    const row = db.prepare(`SELECT COUNT(*) AS count FROM registrations
      WHERE voucher_redeemed_at IS NOT NULL AND voucher_redeem_synced_at IS NULL
        AND voucher_number IS NOT NULL`)
      .get() as { count: number }
    return { count: row.count }
  })
}
