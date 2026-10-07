import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'

const TABLE: Record<string, string> = { masters: 'tandem_masters', flyers: 'camera_flyers' }

// Only camera flyers carry an email: it is where the contacts of the guests
// they filmed will be sent, so they can deliver the video.
const WITH_EMAIL = new Set(['flyers'])
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const columns = (kind: string) => (WITH_EMAIL.has(kind) ? 'id,name,email' : 'id,name')

type CrewInput = { name: string; email: string | null }

// Shared by POST and PATCH. An empty or missing email is stored as NULL, so
// clearing the field in the edit row removes the address.
function parseCrewInput(kind: string, body: any): CrewInput | { error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return { error: 'Name fehlt' }
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) return { name, email: null }
  if (!WITH_EMAIL.has(kind)) return { error: 'E-Mail nur für Kameraflieger' }
  if (!EMAIL_PATTERN.test(email)) return { error: 'E-Mail ungültig' }
  return { name, email }
}

export function registerStammdatenRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/:kind', async (req, reply) => {
    const kind = (req.params as any).kind
    const t = TABLE[kind]
    if (!t) return reply.code(404).send()
    return db.prepare(`SELECT ${columns(kind)} FROM ${t} WHERE active=1 ORDER BY name`).all()
  })

  app.post('/api/:kind', async (req, reply) => {
    const kind = (req.params as any).kind
    const t = TABLE[kind]
    if (!t) return reply.code(404).send()
    const input = parseCrewInput(kind, req.body)
    if ('error' in input) return reply.code(400).send(input)
    const i = WITH_EMAIL.has(kind)
      ? db.prepare(`INSERT INTO ${t} (name,email,active) VALUES (?,?,1)`).run(input.name, input.email)
      : db.prepare(`INSERT INTO ${t} (name,active) VALUES (?,1)`).run(input.name)
    return reply.code(201).send({ id: i.lastInsertRowid })
  })

  app.patch('/api/:kind/:id', async (req, reply) => {
    const { kind, id } = req.params as any
    const t = TABLE[kind]
    if (!t) return reply.code(404).send()
    const input = parseCrewInput(kind, req.body)
    if ('error' in input) return reply.code(400).send(input)
    // A removed entry stays in the table (soft delete) but is not editable.
    const r = WITH_EMAIL.has(kind)
      ? db.prepare(`UPDATE ${t} SET name=?, email=? WHERE id=? AND active=1`).run(input.name, input.email, id)
      : db.prepare(`UPDATE ${t} SET name=? WHERE id=? AND active=1`).run(input.name, id)
    if (r.changes === 0) return reply.code(404).send()
    return db.prepare(`SELECT ${columns(kind)} FROM ${t} WHERE id=?`).get(id)
  })

  app.delete('/api/:kind/:id', async (req, reply) => {
    const t = TABLE[(req.params as any).kind]
    if (!t) return reply.code(404).send()
    db.prepare(`UPDATE ${t} SET active=0 WHERE id=?`).run((req.params as any).id)
    return reply.code(204).send()
  })
}
