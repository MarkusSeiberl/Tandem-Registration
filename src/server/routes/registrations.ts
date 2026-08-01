import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import { validateGuest } from '../validation'
import { SseHub } from '../sse'
import { fillContractPdf } from '../contractPdf'
import {
  computePrice, COLLECTED_VIA, EXTRA_BOOKINGS, PAYMENT_METHODS, VOUCHER_SERVICES,
  WEIGHT_SURCHARGES,
} from '../pricing'
import type { Config } from '../config'

const today = () => new Date().toISOString().slice(0, 10)

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
    // jump price. The manifest recomputes it as soon as it saves an extra, a
    // surcharge or a voucher.
    const info = db.prepare(`INSERT INTO registrations
      (first_name,last_name,gender,age,height_cm,weight_kg,
       street,postal_code,city,email,phone,contract_pdf_filename,
       accepted_terms,created_at,jump_date,
       extra_booking,weight_surcharge,price,price_override)
      VALUES (@first_name,@last_name,@gender,@age,@height_cm,@weight_kg,
       @street,@postal_code,@city,@email,@phone,
       @contract_pdf_filename,1,@created_at,@jump_date,
       'none','none',@price,0)`)
      .run({
        ...v, contract_pdf_filename: filename, created_at: new Date().toISOString(),
        jump_date: jumpDate, price: computePrice({}, cfgRef.current.prices),
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

  const ALLOWED = ['tandem_master_id', 'load_number', 'price', 'price_override',
    'payment_method', 'voucher_payment_method', 'voucher_number', 'voucher_service',
    'extra_booking', 'weight_surcharge', 'camera_flyer_id', 'paid_at'] as const
  // Changing any of these changes what the guest owes, so a non-overridden price
  // has to be recomputed in the same statement.
  const PRICING_FIELDS = [
    'payment_method', 'voucher_service', 'extra_booking', 'weight_surcharge',
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
      body.price = computePrice({ ...current, ...body }, cfgRef.current.prices)
    }

    const keys = ALLOWED.filter(k => k in body)
    if (keys.length) {
      const set = keys.map(k => `${k}=@${k}`).join(', ')
      const params: Record<string, unknown> = { id }
      for (const k of keys) params[k] = body[k]
      const result = db.prepare(`UPDATE registrations SET ${set} WHERE id=@id`).run(params)
      if (result.changes === 0) return reply.code(404).send()
      sse.broadcast('changed', { id })
      return db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    }
    return current
  })

  app.delete('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const row = db.prepare('SELECT contract_pdf_filename FROM registrations WHERE id=?').get(id) as
      { contract_pdf_filename: string | null } | undefined
    const result = db.prepare('DELETE FROM registrations WHERE id=?').run(id)
    if (result.changes === 0) return reply.code(404).send()

    // Best-effort: remove the generated contract PDF too. A failure here (file
    // already gone, permissions) must not fail the delete — the DB row, the
    // source of truth, is already removed.
    if (row?.contract_pdf_filename) {
      const filePath = path.join(cfgRef.current.exportDir, 'vertaege', row.contract_pdf_filename)
      await fs.unlink(filePath).catch(() => {})
    }

    sse.broadcast('changed', { id })
    return reply.code(204).send()
  })
}
