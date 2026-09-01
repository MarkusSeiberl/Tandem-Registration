import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import { buildWorkbook, DEFAULT_COLUMNS } from '../excel'
import type { TotalRow } from '../excel'
import {
  extraBookingLabel, genderLabel, paymentLabel, voucherServiceLabel, weightSurchargeLabel,
} from '../labels'
import { collectedVia } from '../pricing'
import { payoutSections } from '../payouts'
import { tablesForDay } from '../dayTables'
import { redeemVoucher } from '../voucherRedeem'
import type { Config } from '../config'
import { today } from '../day'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function registerExportRoutes(app: FastifyInstance, db: Database, cfgRef: { current: Config }) {
  app.post('/api/export', async (req, reply) => {
    const rawDate = (req.query as any)?.date
    if (rawDate !== undefined && !DATE_RE.test(rawDate)) {
      return reply.code(400).send({ error: 'Datum ungültig' })
    }
    const date = rawDate || today()
    const rows = db.prepare('SELECT * FROM registrations WHERE jump_date=? ORDER BY id').all(date) as any[]
    const masters = new Map<number, string>(
      (db.prepare('SELECT id,name FROM tandem_masters').all() as any[]).map(m => [m.id, m.name]))
    const flyers = new Map<number, string>(
      (db.prepare('SELECT id,name FROM camera_flyers').all() as any[]).map(f => [f.id, f.name]))
    // The sheet is read by the club, so every stored id/enum is resolved to the
    // German text here — otherwise the columns would show raw values ('voucher',
    // 'video_photo') instead of the labels the manifest UI displays.
    // Summed before the labels are applied, while the payment fields are still
    // stored enums. Only money that moved today counts: a voucher's own value was
    // paid in an earlier season, so a voucher row contributes just the difference
    // the guest topped up — which is exactly what `price` holds for it. That
    // top-up is cash or card like any other, so it lands in those tills, not in a
    // bucket of its own.
    const sum = (predicate: (r: any) => boolean) => rows
      .filter(predicate)
      .reduce((total, r) => total + (r.price ?? 0), 0)
    const totals: TotalRow[] = [
      { label: 'Summe Bar', amount: sum(r => collectedVia(r) === 'cash') },
      { label: 'Summe Karte', amount: sum(r => collectedVia(r) === 'card') },
      // A non-zero figure here means a row was left without a payment method —
      // the till will not add up until someone fills it in.
      { label: 'Summe ohne Zahlungsart', amount: sum(r => collectedVia(r) === null) },
      { label: 'Gesamt', amount: rows.reduce((t, r) => t + (r.price ?? 0), 0) },
      // Memo line: already counted above, shown so the club can see how much of
      // the day came from guests topping up a voucher.
      { label: 'davon Gutschein-Zuzahlung', amount: sum(r => r.payment_method === 'voucher') },
    ]

    // Computed before the loop below, which overwrites the id columns with names —
    // the payout rule groups by id and reads the stored `extra_booking` enum.
    // The rates this day was flown under, not the ones the settings carry today:
    // an export of last Saturday has to say what was handed over that Saturday.
    const dayPayouts = tablesForDay(db, date, cfgRef.current).payouts
    const payouts = payoutSections(rows, masters, flyers, dayPayouts)

    // Every redemption that did not reach the club's file when the row was
    // collected gets one more attempt here. This is the "at latest at export"
    // half of the promise; the collect handler is the other.
    //
    // Deliberately not scoped to `date`: the queue is everything still owed to
    // the file, whatever day it was collected on. A file locked all Saturday
    // leaves Saturday's rows outstanding, and the banner counts them on Sunday
    // too — an export that only retried its own date could never bring that
    // count back to zero, and nothing would tell the operator to go back and
    // re-export Saturday. The predicate is otherwise word for word the one the
    // banner counts (see routes/voucher.ts), so the two cannot disagree about
    // what "still open" means.
    let redemptionsWritten = 0
    let redemptionsPending = 0
    let redemptionsInvalid = 0
    const owed = db.prepare(`SELECT id, voucher_number FROM registrations
      WHERE voucher_redeemed_at IS NOT NULL AND voucher_redeem_synced_at IS NULL
        AND voucher_number IS NOT NULL ORDER BY id`).all() as any[]
    for (const row of owed) {
      // One unwritable voucher must not cost the club the day's export, which is
      // built below and is what the operator actually asked for. Same reasoning
      // as the collect handler in routes/registrations.ts: everything about the
      // voucher list is best-effort beside the operator's real work. A throw is
      // counted as still open, so the next export tries the row again.
      try {
        const outcome = await redeemVoucher(cfgRef.current, row.voucher_number, new Date())
        if (outcome === 'written' || outcome === 'already_redeemed') {
          // 'already_redeemed' is read differently here than in the collect
          // handler. There it means "the date is someone else's, claim nothing".
          // Here the row already carries our own voucher_redeemed_at, so a date
          // in the cell is in the normal case an earlier attempt of ours that
          // landed after all. Either way the file now says what we wanted it to
          // say, and treating that as written is what stops a date typed in by
          // hand from parking the row in the queue forever.
          db.prepare('UPDATE registrations SET voucher_redeem_synced_at=@now WHERE id=@id')
            .run({ id: row.id, now: new Date().toISOString() })
          redemptionsWritten += 1
        } else if (outcome === 'invalid') {
          // The list says this voucher is not good after all — unpaid, or
          // cancelled. Take the redemption back so it stops being counted as
          // something the file still owes.
          db.prepare('UPDATE registrations SET voucher_redeemed_at=NULL WHERE id=@id')
            .run({ id: row.id })
          redemptionsInvalid += 1
        } else if (outcome === 'failed' || outcome === 'unknown') {
          // 'unknown' is the list having no single row for this number: not
          // there, or there twice. That is not the list saying no, so the
          // redemption stays and the row stays in the queue for a human to
          // resolve — a number typed with a digit missing, a voucher the club
          // has yet to enter, the same number carried onto two sheets. It was
          // once folded into 'invalid', and while only the first sheet of a
          // multi-sheet list was being read, that erased every redemption of
          // the current season on the first export.
          redemptionsPending += 1
        } else if (outcome === 'disabled') {
          // No list configured — the club switched the feature off. Nothing is
          // owed to a file that is not there, so this is neither written nor
          // open; the stamps are left untouched in case a path comes back. The
          // banner is silent for the same reason (see routes/voucher.ts).
        }
      } catch (err) {
        app.log.error({ err, id: row.id },
          'Gutschein-Einlösung konnte beim Export nicht geschrieben werden')
        redemptionsPending += 1
      }
    }

    for (const r of rows) {
      r.tandem_master_id = masters.get(r.tandem_master_id) ?? ''
      r.camera_flyer_id = flyers.get(r.camera_flyer_id) ?? ''
      r.gender = genderLabel(r.gender)
      r.payment_method = paymentLabel(r.payment_method)
      r.voucher_payment_method = paymentLabel(r.voucher_payment_method)
      r.extra_booking = extraBookingLabel(r.extra_booking)
      r.voucher_service = voucherServiceLabel(r.voucher_service)
      r.weight_surcharge = weightSurchargeLabel(r.weight_surcharge)
      r.address = `${r.street}, ${r.postal_code}, ${r.city}`
    }
    const meta = [
      { label: 'Datum', value: date },
      { label: 'Ort', value: cfgRef.current.jumpLocation },
      // Left blank on purpose — the Betriebsleiter signs this by hand.
      { label: 'Betriebsleiter (BL)', value: '' },
    ]
    const buf = await buildWorkbook(rows, DEFAULT_COLUMNS, meta, totals, payouts)
    const dir = cfgRef.current.exportDir
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `Tandem_${date}.xlsx`)
    await fs.writeFile(filePath, buf)
    return reply.send({
      path: filePath, count: rows.length,
      redemptionsWritten, redemptionsPending, redemptionsInvalid,
    })
  })
}
