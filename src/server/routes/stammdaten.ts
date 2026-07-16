import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'

const TABLE: Record<string, string> = { masters: 'tandem_masters', flyers: 'camera_flyers' }

export function registerStammdatenRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/:kind', async (req, reply) => {
    const t = TABLE[(req.params as any).kind]
    if (!t) return reply.code(404).send()
    return db.prepare(`SELECT id,name FROM ${t} WHERE active=1 ORDER BY name`).all()
  })

  app.post('/api/:kind', async (req, reply) => {
    const t = TABLE[(req.params as any).kind]
    if (!t) return reply.code(404).send()
    const name = (req.body as any)?.name
    if (!name?.trim()) return reply.code(400).send({ error: 'Name fehlt' })
    const i = db.prepare(`INSERT INTO ${t} (name,active) VALUES (?,1)`).run(name.trim())
    return reply.code(201).send({ id: i.lastInsertRowid })
  })

  app.delete('/api/:kind/:id', async (req, reply) => {
    const t = TABLE[(req.params as any).kind]
    if (!t) return reply.code(404).send()
    db.prepare(`UPDATE ${t} SET active=0 WHERE id=?`).run((req.params as any).id)
    return reply.code(204).send()
  })
}
