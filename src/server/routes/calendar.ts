import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * How many tandems were registered on each day of one month, for the calendar
 * on the Übersicht.
 *
 * Counts every registration filed under the day — the same rows the manifest
 * lists for it. Days without a single registration are simply absent, so the
 * screen does not have to tell "nothing flown" from "nothing sent".
 */
export function registerCalendarRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/calendar/:month', async (req, reply) => {
    const month = (req.params as any).month
    if (!MONTH.test(month)) return reply.code(400).send({ error: 'Monat ungültig' })
    // jump_date is always YYYY-MM-DD, so a prefix match selects the month and
    // still uses the plain text comparison rather than parsing dates in SQL.
    const rows = db.prepare(
      `SELECT jump_date AS date, COUNT(*) AS count FROM registrations
       WHERE jump_date >= ? AND jump_date < ?
       GROUP BY jump_date ORDER BY jump_date`
    ).all(`${month}-01`, `${month}-32`) as { date: string; count: number }[]
    return { days: rows }
  })
}
