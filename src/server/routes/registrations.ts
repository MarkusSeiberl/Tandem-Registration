import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import { validateGuest } from '../validation'
import { SseHub } from '../sse'
import { fillContractPdf, stampContract } from '../contractPdf'
import {
  computePrice, surchargeForWeight, COLLECTED_VIA, EXTRA_BOOKINGS, PAYMENT_METHODS,
  VOUCHER_SERVICES, WEIGHT_SURCHARGES,
} from '../pricing'
import type { Config } from '../config'
import { dayIsFrozen, repriceDay, startDay, tablesForDay } from '../dayTables'
import { today } from '../day'

function safeNamePart(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]/g, '')
}

// Claims a filename and writes `pdf` to it atomically: opening with the 'wx'
// flag fails with EEXIST if the file already exists, so the existence check
// and the write happen as a single OS-level operation. This closes a TOCTOU
// race that a separate fs.access()-then-fs.writeFile() pair would leave open
// (multiple kiosk tablets can hit this server concurrently).
async function writeContractPdf(dir: string, base: string, pdf: Buffer): Promise<string> {
  let candidate = `${base}.pdf`
  let n = 2
  while (true) {
    try {
      const handle = await fs.open(path.join(dir, candidate), 'wx')
      try {
        await handle.writeFile(pdf)
      } finally {
        await handle.close()
      }
      return candidate
    } catch (err: any) {
      if (err.code !== 'EEXIST') throw err
      candidate = `${base} (${n}).pdf`
      n += 1
    }
  }
}

export function registerRegistrationRoutes(
  app: FastifyInstance,
  db: Database,
  sse: SseHub,
  cfgRef: { current: Config },
  contractTemplate: Buffer,
  notify?: (guestName: string) => void
) {
  app.post('/api/registrations', async (req, reply) => {
    const r = validateGuest(req.body)
    if (!r.ok) return reply.code(400).send({ errors: r.errors })
    const v = r.value
    const jumpDate = today()

    const vertraegeDir = path.join(cfgRef.current.exportDir, 'vertaege')
    await fs.mkdir(vertraegeDir, { recursive: true })
    const dateStamp = jumpDate.replace(/-/g, '.')
    const base = `${dateStamp}_${safeNamePart(v.last_name)}-${safeNamePart(v.first_name)}`

    const pdf = await fillContractPdf(contractTemplate, {
      firstName: v.first_name, lastName: v.last_name,
      street: v.street, postalCode: v.postal_code, city: v.city,
      phone: v.phone, email: v.email,
      age: v.age, heightCm: v.height_cm, weightKg: v.weight_kg,
      ort: cfgRef.current.jumpLocation,
      datum: jumpDate.split('-').reverse().join('.'),
      signaturePngDataUrl: v.signature_png,
    })
    const filename = await writeContractPdf(vertraegeDir, base, pdf)

    // The guest never picks anything priced, so a fresh row starts at the plain
    // jump price. The manifest recomputes it as soon as it saves an extra or a
    // voucher. The weight surcharge is the one exception: it follows from the
    // weight the guest just entered, so it is decided here rather than left for
    // someone to notice — and the starting price has to include it.
    // The first registration of a jump day settles what that day costs; every
    // later one is priced from the same list, however often the settings change
    // in between.
    const dayPrices = startDay(db, jumpDate, cfgRef.current).prices
    const weightSurcharge = surchargeForWeight(v.weight_kg)
    const info = db.prepare(`INSERT INTO registrations
      (first_name,last_name,gender,age,height_cm,weight_kg,
       street,postal_code,city,email,phone,contract_pdf_filename,
       accepted_terms,privacy_ack_at,created_at,jump_date,
       extra_booking,weight_surcharge,price,price_override)
      VALUES (@first_name,@last_name,@gender,@age,@height_cm,@weight_kg,
       @street,@postal_code,@city,@email,@phone,
       @contract_pdf_filename,1,@privacy_ack_at,@created_at,@jump_date,
       'none',@weight_surcharge,@price,0)`)
      .run({
        ...v, contract_pdf_filename: filename, created_at: new Date().toISOString(),
        // The server's clock, not the tablet's: when a guest acknowledged the
        // data-protection notice is a record the club may have to stand behind.
        privacy_ack_at: new Date().toISOString(),
        jump_date: jumpDate, weight_surcharge: weightSurcharge,
        price: computePrice({ weight_surcharge: weightSurcharge }, dayPrices),
      })
    sse.broadcast('changed', { id: info.lastInsertRowid })
    // Best-effort desktop notification on the server machine; never blocks the
    // response or fails the registration.
    notify?.(`${v.first_name} ${v.last_name}`)
    return reply.code(201).send({ id: info.lastInsertRowid })
  })

  app.get('/api/registrations', async (req) => {
    const date = (req.query as any)?.date || today()
    return db.prepare('SELECT * FROM registrations WHERE jump_date = ? ORDER BY id')
      .all(date)
  })

  app.get('/api/registrations/:id/contract.pdf', async (req, reply) => {
    const id = (req.params as any).id
    const row = db.prepare('SELECT contract_pdf_filename FROM registrations WHERE id=?').get(id) as
      { contract_pdf_filename: string | null } | undefined
    if (!row?.contract_pdf_filename) return reply.code(404).send()
    const filePath = path.join(cfgRef.current.exportDir, 'vertaege', row.contract_pdf_filename)
    try {
      const bytes = await fs.readFile(filePath)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', 'inline')
      return reply.send(bytes)
    } catch {
      return reply.code(404).send()
    }
  })

  app.get('/api/events', (req, reply) => sse.handler(req, reply))

  const DATE = /^\d{4}-\d{2}-\d{2}$/

  // What a given jump day runs on, and whether that still matches the settings.
  // The manifest prices its breakdown from this, so the detail screen and the
  // list can no longer show two different numbers for the same registration.
  app.get('/api/day-tables/:date', async (req, reply) => {
    const date = (req.params as any).date
    if (!DATE.test(date)) return reply.code(400).send({ error: 'Datum ungültig' })
    const tables = tablesForDay(db, date, cfgRef.current)
    return {
      ...tables,
      // A day nobody has registered on yet is only quoted at today's tables —
      // it is not settled, and saying so keeps the manifest from warning about
      // a difference that does not exist yet.
      frozen: dayIsFrozen(db, date),
      current: { prices: cfgRef.current.prices, payouts: cfgRef.current.payouts },
    }
  })

  // Moves today onto today's tables: the deliberate exception, for the day that
  // was already running when someone noticed the price list was wrong.
  //
  // Today and nothing else. A day that is over has been flown, collected and
  // usually exported; its amounts are what guests actually paid, and a price
  // list edited afterwards is not an opinion about them. The route enforces it
  // rather than trusting the manifest to hide the button, because the manifest
  // is one client of several and the damage would be silent.
  app.post('/api/day-tables/:date/reprice', async (req, reply) => {
    const date = (req.params as any).date
    if (!DATE.test(date)) return reply.code(400).send({ error: 'Datum ungültig' })
    if (date !== today())
      return reply.code(409).send({ error: 'Nur der heutige Tag kann umgestellt werden.' })
    const updated = repriceDay(db, date, cfgRef.current, (row, prices) =>
      computePrice(row as Parameters<typeof computePrice>[0], prices))
    sse.broadcast('changed', { date })
    return { updated }
  })

  const ALLOWED = ['tandem_master_id', 'load_number', 'price', 'price_override',
    'payment_method', 'voucher_payment_method', 'voucher_number', 'voucher_service',
    'voucher_topup', 'voucher_amount',
    'extra_booking', 'weight_surcharge', 'camera_flyer_id', 'paid_at', 'notes'] as const
  // Changing any of these changes what the guest owes, so a non-overridden price
  // has to be recomputed in the same statement.
  const PRICING_FIELDS = [
    'payment_method', 'voucher_service', 'voucher_topup', 'voucher_amount',
    'extra_booking', 'weight_surcharge',
  ] as const

  app.patch('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const body = { ...((req.body as any) ?? {}) }
    // The manifest marks a row collected with a flag; the timestamp is the
    // server's to write. A tablet whose clock is off must not be able to decide
    // when the money came in — and `paid_at` from a client is ignored entirely.
    const paid = body.paid
    delete body.paid
    delete body.paid_at
    if (paid !== undefined && typeof paid !== 'boolean')
      return reply.code(400).send({ error: 'Kassiert-Status ungültig' })
    if ('payment_method' in body && !PAYMENT_METHODS.includes(body.payment_method))
      return reply.code(400).send({ error: 'Zahlungsart ungültig' })
    // Cleared with null like camera_flyer_id; a load is only ever counted
    // upwards, so a negative number is a typo, not a load.
    if ('load_number' in body && body.load_number !== null &&
        (!Number.isInteger(body.load_number) || body.load_number < 0))
      return reply.code(400).send({ error: 'Load-Nr. ungültig' })
    if ('extra_booking' in body && !EXTRA_BOOKINGS.includes(body.extra_booking))
      return reply.code(400).send({ error: 'Zusatzbuchung ungültig' })
    if ('weight_surcharge' in body && !WEIGHT_SURCHARGES.includes(body.weight_surcharge))
      return reply.code(400).send({ error: 'Gewichtszuschlag ungültig' })
    // Unlike the two above, these are cleared (null) whenever the guest stops
    // paying by voucher, so null is a legal value here.
    if ('voucher_service' in body && body.voucher_service !== null &&
        !VOUCHER_SERVICES.includes(body.voucher_service))
      return reply.code(400).send({ error: 'Gutschein-Leistung ungültig' })
    if ('voucher_payment_method' in body && body.voucher_payment_method !== null &&
        !COLLECTED_VIA.includes(body.voucher_payment_method))
      return reply.code(400).send({ error: 'Zahlungsart der Zuzahlung ungültig' })

    // What the club's list says the voucher was paid for, as the manifest read
    // it. Cleared to NULL along with the number whenever the guest stops paying
    // by voucher, so null is a legal value.
    if ('voucher_amount' in body && body.voucher_amount !== null &&
        (typeof body.voucher_amount !== 'number' || !Number.isFinite(body.voucher_amount)))
      return reply.code(400).send({ error: 'Gutscheinbetrag ungültig' })
    // SQLite has no boolean type; normalised the same way price_override is.
    if ('voucher_topup' in body) body.voucher_topup = body.voucher_topup ? 1 : 0

    // Free text, so nothing to validate beyond the type — but an empty note is
    // stored as NULL rather than '' so the export shows a blank cell either way.
    if ('notes' in body) {
      if (body.notes !== null && typeof body.notes !== 'string')
        return reply.code(400).send({ error: 'Anmerkung ungültig' })
      const trimmed = typeof body.notes === 'string' ? body.notes.trim() : ''
      body.notes = trimmed === '' ? null : trimmed
    }

    const current = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as any
    if (!current) return reply.code(404).send()

    // Collecting a row that is already collected keeps the original time — the
    // stamp records when the money arrived, not when someone last tapped.
    if (paid === true && !current.paid_at) body.paid_at = new Date().toISOString()
    else if (paid === false) body.paid_at = null

    // A price sent by the manifest is always a manual correction — the computed
    // amount never travels over the wire. Sending price_override:0 hands control
    // back to the price table.
    if ('price' in body) body.price_override = 1
    // SQLite has no boolean type and better-sqlite3 refuses to bind one, so the
    // flag is normalised whether the manifest sends true/false or 1/0.
    if ('price_override' in body) body.price_override = body.price_override ? 1 : 0
    const overridden = 'price_override' in body ? !!body.price_override : !!current.price_override
    if (!overridden && PRICING_FIELDS.some(k => k in body)) {
      // The price list of the day this jump belongs to, never the settings
      // screen's. Saving a row for an unrelated reason therefore produces the
      // amount it already had, however often the table was edited since.
      const prices = tablesForDay(db, current.jump_date, cfgRef.current).prices
      body.price = computePrice({ ...current, ...body }, prices)
    }

    const keys = ALLOWED.filter(k => k in body)
    if (keys.length) {
      const set = keys.map(k => `${k}=@${k}`).join(', ')
      const params: Record<string, unknown> = { id }
      for (const k of keys) params[k] = body[k]
      const result = db.prepare(`UPDATE registrations SET ${set} WHERE id=@id`).run(params)
      if (result.changes === 0) return reply.code(404).send()
      // Only when one of the two stamped fields actually changed: every save from
      // the detail screen carries a voucher_number and a tandem_master_id, and
      // rewriting the signed PDF on each of them would churn the file for
      // nothing. Both values are read from the row as it stands after the
      // update, never from the patch alone — a correction to one must not wipe
      // the other off the page, and the stamp is drawn as a whole.
      const stampedChanged =
        ('voucher_number' in body && body.voucher_number !== current.voucher_number) ||
        ('tandem_master_id' in body && body.tandem_master_id !== current.tandem_master_id)
      if (stampedChanged) {
        const masterId = 'tandem_master_id' in body
          ? body.tandem_master_id
          : current.tandem_master_id
        await restampContract(current.contract_pdf_filename, {
          voucherNumber: 'voucher_number' in body ? body.voucher_number : current.voucher_number,
          tandemMaster: masterName(masterId),
        })
      }

      // Everything about the voucher list is best-effort, so all of it sits
      // inside one try: the re-SELECT can come back empty if the row was
      // deleted between the UPDATE and here, and the two follow-up UPDATEs can
      // hit SQLITE_BUSY. The operator's save is already committed at this
      // point and must survive either.
      try {
        // Collecting a voucher row is the moment it is spent — for us. Nothing
        // is written into the club's file here: that file lives in the club's
        // OneDrive, is read whole and written whole, and can be locked or
        // mid-sync at exactly the moment the operator is standing at the till.
        // The row is queued instead, and the export sweep does every write,
        // every retry and every verdict on the list in one place.
        const after = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as any
        // A corrected number moves the redemption to a different voucher. The
        // date already written stays in the club's file — the same rule as
        // un-collecting — but both our stamps described the old number: left
        // alone, the row would claim the *new* voucher had reached the file
        // while that voucher was in fact never redeemed at all, invisible to
        // both the banner and the export. So both are dropped. A row that is
        // still collected on a voucher is still a redemption we stand behind,
        // so it is recorded afresh as unwritten and the export sweep takes it
        // from there against the new number.
        if ('voucher_number' in body && body.voucher_number !== current.voucher_number &&
            current.voucher_redeemed_at) {
          const stillOnVoucher = !!after?.paid_at &&
            after.payment_method === 'voucher' && !!after.voucher_number
          db.prepare(`UPDATE registrations
            SET voucher_redeemed_at=@redeemed, voucher_redeem_synced_at=NULL WHERE id=@id`)
            .run({ id, redeemed: stillOnVoucher ? new Date().toISOString() : null })
        }
        // `!current.paid_at` keeps this to the transition into collected, and a
        // row whose redemption already reached the file is left alone: a
        // re-collect must not hand the sweep a date it has long since written.
        // Whether the list accepts the number at all is the sweep's question;
        // the operator saw that verdict beside the field before collecting.
        if (paid === true && !current.paid_at && !after?.voucher_redeem_synced_at &&
            after?.payment_method === 'voucher' && after.voucher_number) {
          db.prepare('UPDATE registrations SET voucher_redeemed_at=@now WHERE id=@id')
            .run({ id, now: new Date().toISOString() })
        }
        // Putting a row back to open drops a redemption that never reached the
        // file. One that did is left alone — silently deleting a date from the
        // club's list is worse than a stale one a human can correct.
        if (paid === false) {
          db.prepare(`UPDATE registrations SET voucher_redeemed_at=NULL
            WHERE id=@id AND voucher_redeem_synced_at IS NULL`).run({ id })
        }
      } catch (err) {
        // Deliberately swallowed: a failure to note the redemption must never
        // fail the operator's save. The catch does nothing beyond logging —
        // keeping the save intact is the whole point.
        app.log.error({ err, id }, 'Gutschein-Einlösung konnte nicht vermerkt werden')
      }

      // The UPDATE above has already committed, so a throw from here on must
      // not turn into a 500 — that would read as the save having failed when
      // it actually succeeded, and the operator would retry into a confusing
      // second state. Falling back to `current` (already SELECTed before the
      // UPDATE) covers both the broadcast throwing and the final read coming
      // back empty or erroring; one try/catch around both statements is a
      // smaller change than guarding each separately.
      try {
        sse.broadcast('changed', { id })
        return db.prepare('SELECT * FROM registrations WHERE id=?').get(id) ?? current
      } catch (err) {
        app.log.error({ err, id }, 'Antwort nach dem Speichern konnte nicht aufgebaut werden')
        return current
      }
    }
    return current
  })

  // The name that goes on the contract, resolved at stamping time. The row
  // stores an id; a contract stores what was true when it was printed, which is
  // why a later rename in the Stammdaten does not travel back into PDFs already
  // on disk.
  function masterName(id: number | null | undefined): string | null {
    if (id === null || id === undefined) return null
    const row = db.prepare('SELECT name FROM tandem_masters WHERE id=?').get(id) as
      { name: string | null } | undefined
    return row?.name ?? null
  }

  // Writes the voucher number and the Tandemmaster onto the contract that was
  // signed at registration time. Best-effort on purpose: the row is the record
  // that matters, and losing an operator's till entry because a PDF was locked by
  // a viewer would be the worse failure. The manifest can always check the result
  // via "Vertrag öffnen".
  async function restampContract(
    filename: string | null,
    stamps: { voucherNumber: string | null; tandemMaster: string | null }
  ) {
    if (!filename) return
    const filePath = path.join(cfgRef.current.exportDir, 'vertaege', filename)
    try {
      const stamped = await stampContract(await fs.readFile(filePath), stamps)
      await fs.writeFile(filePath, stamped)
    } catch (err) {
      app.log.error({ err, filename }, 'Vertrag konnte nicht nachgestempelt werden')
    }
  }

  app.delete('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const result = db.prepare('DELETE FROM registrations WHERE id=?').run(id)
    if (result.changes === 0) return reply.code(404).send()

    // The generated contract PDF is deliberately left on disk: it is a signed
    // legal document, and removing the row must not destroy the club's record.

    sse.broadcast('changed', { id })
    return reply.code(204).send()
  })
}
