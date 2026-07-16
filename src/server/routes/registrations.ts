import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { validateGuest } from '../validation'
import { SseHub } from '../sse'

const today = () => new Date().toISOString().slice(0, 10)

export function registerRegistrationRoutes(app: FastifyInstance, db: Database, sse: SseHub) {
  app.post('/api/registrations', async (req, reply) => {
    const r = validateGuest(req.body)
    if (!r.ok) return reply.code(400).send({ errors: r.errors })
    const v = r.value
    const info = db.prepare(`INSERT INTO registrations
      (first_name,last_name,age,weight_kg,address,email,phone,signature_png,
       accepted_terms,created_at,jump_date)
      VALUES (@first_name,@last_name,@age,@weight_kg,@address,@email,@phone,
       @signature_png,1,@created_at,@jump_date)`)
      .run({ ...v, created_at: new Date().toISOString(), jump_date: today() })
    sse.broadcast('changed', { id: info.lastInsertRowid })
    return reply.code(201).send({ id: info.lastInsertRowid })
  })

  app.get('/api/registrations', async (req) => {
    const date = (req.query as any)?.date || today()
    return db.prepare('SELECT * FROM registrations WHERE jump_date = ? ORDER BY id')
      .all(date)
  })

  app.get('/api/events', (req, reply) => sse.handler(req, reply))

  const ALLOWED = ['tandem_master_id', 'load_number', 'price', 'payment_method',
    'extra_booking', 'camera_flyer_id'] as const
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
}
