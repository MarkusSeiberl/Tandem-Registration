import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { fillUrkundePdf } from '../urkundePdf'

// Drawn on demand rather than stored: unlike the signed contract, the
// certificate carries nothing that is not already in the row.
export function registerUrkundeRoutes(app: FastifyInstance, db: Database, urkundeTemplate: Buffer) {
  app.get('/api/registrations/:id/urkunde.pdf', async (req, reply) => {
    const id = (req.params as any).id
    const row = db.prepare('SELECT first_name, last_name, jump_date FROM registrations WHERE id=?').get(id) as
      { first_name: string; last_name: string; jump_date: string } | undefined
    if (!row) return reply.code(404).send()
    const pdf = await fillUrkundePdf(urkundeTemplate, {
      name: `${row.first_name} ${row.last_name}`,
      jumpDate: row.jump_date,
    })
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'inline')
    return reply.send(pdf)
  })
}
