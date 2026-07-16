import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import { buildWorkbook, DEFAULT_COLUMNS } from '../excel'
import { extraBookingLabel, genderLabel, paymentLabel } from '../labels'

const today = () => new Date().toISOString().slice(0, 10)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function registerExportRoutes(app: FastifyInstance, db: Database, getExportDir: () => string) {
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
    for (const r of rows) {
      r.tandem_master_id = masters.get(r.tandem_master_id) ?? ''
      r.camera_flyer_id = flyers.get(r.camera_flyer_id) ?? ''
      r.gender = genderLabel(r.gender)
      r.payment_method = paymentLabel(r.payment_method)
      r.extra_booking = extraBookingLabel(r.extra_booking)
    }
    const buf = await buildWorkbook(rows, DEFAULT_COLUMNS)
    const dir = getExportDir()
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `Tandem_${date}.xlsx`)
    await fs.writeFile(filePath, buf)
    return reply.send({ path: filePath, count: rows.length })
  })
}
