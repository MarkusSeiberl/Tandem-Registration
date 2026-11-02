import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import type { Config, Prices } from '../config'
import { tablesForDay } from '../dayTables'
import { jumpStats, jumpTotals, moneyStats, moneyTotals } from '../stats'
import type { Comparison, StatsRow } from '../stats'
import { isLocal } from './isLocal'

const YEAR = /^\d{4}$/

const COLUMNS = `jump_date, tandem_master_id, camera_flyer_id, extra_booking, payment_method,
  gender, age, city, price, voucher_payment_method, voucher_service, voucher_amount, voucher_check_status,
  voucher_accepted`

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * The yearly report behind the Statistik page.
 *
 * Every figure comes with the year before, so the report answers "how did this
 * season go compared with the last one". While a season is still running it is
 * compared with the previous year only up to the same day: otherwise any report
 * read in spring would look like a collapse against a finished season.
 *
 * The money figures are confidential. The manifest has no login, so the money
 * route answers only the machine the server runs on, by the same rule that
 * guards shutdown and update (see isLocal.ts).
 */
export function registerStatsRoutes(
  app: FastifyInstance,
  db: Database,
  cfgRef: { current: Config },
  now: () => Date = () => new Date(),
) {
  const select = db.prepare(
    `SELECT ${COLUMNS} FROM registrations WHERE jump_date BETWEEN ? AND ? ORDER BY jump_date, id`
  )
  const rowsBetween = (from: string, to: string) => select.all(from, to) as StatsRow[]

  // Which year was asked for, and what it is compared with. undefined: the
  // query did not name a valid year.
  function period(query: unknown) {
    const today = now()
    const asked = (query as { year?: string }).year
    if (asked !== undefined && !YEAR.test(asked)) return undefined
    const year = asked === undefined ? today.getFullYear() : Number(asked)
    const asOf = year === today.getFullYear() ? `${pad(today.getMonth() + 1)}-${pad(today.getDate())}` : null
    const rows = rowsBetween(`${year}-01-01`, `${year}-12-31`)
    const before = rowsBetween(`${year - 1}-01-01`, `${year - 1}-${asOf ?? '12-31'}`)
    const comparedTo: Comparison | null = before.length > 0 ? { year: year - 1, asOf } : null
    return { year, rows, before, comparedTo }
  }

  const names = (table: 'tandem_masters' | 'camera_flyers') => new Map(
    (db.prepare(`SELECT id, name FROM ${table}`).all() as { id: number; name: string }[])
      .map((r) => [r.id, r.name])
  )

  app.get('/api/stats', async (req, reply) => {
    const p = period(req.query)
    if (!p) return reply.code(400).send({ error: 'Jahr ungültig' })
    const masters = names('tandem_masters')
    const stats = jumpStats(p.rows, masters, names('camera_flyers'), p.year)

    const years = (db.prepare(
      `SELECT DISTINCT CAST(substr(jump_date, 1, 4) AS INTEGER) AS y FROM registrations
       WHERE jump_date IS NOT NULL`
    ).all() as { y: number }[]).map((r) => r.y)
    stats.years = [...new Set([...years, p.year])].sort((a, b) => a - b)

    if (p.comparedTo) {
      stats.previous = jumpTotals(p.before)
      stats.comparedTo = p.comparedTo
      const earlier = jumpStats(p.before, masters, new Map(), p.year - 1).masters
      for (const m of stats.masters) m.previous = earlier.find((e) => e.name === m.name)?.tandems ?? 0
    }
    return stats
  })

  app.get('/api/stats/money', async (req, reply) => {
    if (!isLocal(req.ip)) return reply.code(403).send({ error: 'Nur am Manifest-PC verfügbar' })
    const p = period(req.query)
    if (!p) return reply.code(400).send({ error: 'Jahr ungültig' })
    // tablesForDay only reads: statistics must never freeze a day's price list.
    const cache = new Map<string, Prices>()
    const pricesFor = (date: string) => {
      let prices = cache.get(date)
      if (!prices) cache.set(date, (prices = tablesForDay(db, date, cfgRef.current).prices))
      return prices
    }
    const stats = moneyStats(p.rows, pricesFor, p.year)
    if (p.comparedTo) {
      stats.previous = moneyTotals(p.before, pricesFor)
      stats.comparedTo = p.comparedTo
    }
    return stats
  })
}
