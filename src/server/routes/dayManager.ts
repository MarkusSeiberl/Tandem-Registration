import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'

const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * The Betriebsleiter on duty on one jump day.
 *
 * A fact of the day, not of the club: the export of a day flown weeks ago has
 * to name whoever was on duty then, so the name is stored against the jump date
 * rather than in the settings. Every day starts empty — the sheet has always had
 * the line, and a name carried over from yesterday would be a wrong name nobody
 * looks at twice.
 *
 * Deliberately not part of day_tables: a row there is what marks a day as flown
 * (dayIsFrozen), so putting the name in it would freeze that day's price list as
 * a side effect of typing a name.
 */
export function registerDayManagerRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/day-manager/:date', async (req, reply) => {
    const date = (req.params as any).date
    if (!DATE.test(date)) return reply.code(400).send({ error: 'Datum ungültig' })
    const row = db.prepare('SELECT name FROM day_manager WHERE jump_date=?').get(date) as
      { name: string } | undefined
    return { name: row?.name ?? '' }
  })

  app.put('/api/day-manager/:date', async (req, reply) => {
    const date = (req.params as any).date
    if (!DATE.test(date)) return reply.code(400).send({ error: 'Datum ungültig' })
    const name = (req.body as any)?.name
    // A body without a name is a broken caller, not an operator clearing the
    // field — clearing is an empty string, and it must stay distinguishable so
    // a failed request cannot quietly wipe the day.
    if (typeof name !== 'string') return reply.code(400).send({ error: 'Name fehlt' })

    const trimmed = name.trim()
    if (trimmed === '') {
      db.prepare('DELETE FROM day_manager WHERE jump_date=?').run(date)
      return { name: '' }
    }
    db.prepare(
      `INSERT INTO day_manager (jump_date, name) VALUES (@jump_date, @name)
       ON CONFLICT(jump_date) DO UPDATE SET name=@name`
    ).run({ jump_date: date, name: trimmed })
    return { name: trimmed }
  })
}
