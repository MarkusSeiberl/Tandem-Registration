import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import { validateGuest } from '../validation'
import { SseHub } from '../sse'
import { fillContractPdf } from '../contractPdf'
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
  contractTemplate: Buffer
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

    const info = db.prepare(`INSERT INTO registrations
      (first_name,last_name,gender,age,height_cm,weight_kg,
       street,postal_code,city,email,phone,contract_pdf_filename,
       accepted_terms,created_at,jump_date)
      VALUES (@first_name,@last_name,@gender,@age,@height_cm,@weight_kg,
       @street,@postal_code,@city,@email,@phone,
       @contract_pdf_filename,1,@created_at,@jump_date)`)
      .run({ ...v, contract_pdf_filename: filename, created_at: new Date().toISOString(), jump_date: jumpDate })
    sse.broadcast('changed', { id: info.lastInsertRowid })
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

  const ALLOWED = ['tandem_master_id', 'load_number', 'price', 'payment_method',
    'voucher_number', 'extra_booking', 'camera_flyer_id'] as const
  const PAY = ['voucher', 'cash', 'card']
  const EXTRA = ['none', 'video', 'video_photo']

  app.patch('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const body = (req.body as any) ?? {}
    const keys = ALLOWED.filter(k => k in body)
    if ('payment_method' in body && !PAY.includes(body.payment_method))
      return reply.code(400).send({ error: 'Zahlungsart ungültig' })
    if ('extra_booking' in body && !EXTRA.includes(body.extra_booking))
      return reply.code(400).send({ error: 'Zusatzbuchung ungültig' })
    if (keys.length) {
      const set = keys.map(k => `${k}=@${k}`).join(', ')
      const result = db.prepare(`UPDATE registrations SET ${set} WHERE id=@id`).run({ ...body, id })
      if (result.changes === 0) return reply.code(404).send()
      sse.broadcast('changed', { id })
      return db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    }
    const row = db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    if (!row) return reply.code(404).send()
    return row
  })

  app.delete('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const result = db.prepare('DELETE FROM registrations WHERE id=?').run(id)
    if (result.changes === 0) return reply.code(404).send()
    sse.broadcast('changed', { id })
    return reply.code(204).send()
  })
}
