import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const NOTE_MAX = 500

export interface DayCloseDraft {
  countedCash: number | null
  countedCard: number | null
  note: string
}

/**
 * The Kassensturz stored for a day, or an empty one. Shared with the export,
 * which writes it into the sheet and refuses a difference nobody explained.
 */
export function readDayClose(db: Database, date: string): DayCloseDraft {
  const row = db.prepare('SELECT counted_cash, counted_card, note FROM day_close WHERE jump_date=?')
    .get(date) as { counted_cash: number | null; counted_card: number | null; note: string } | undefined
  return {
    countedCash: row?.counted_cash ?? null,
    countedCard: row?.counted_card ?? null,
    note: row?.note ?? '',
  }
}

// null is "not counted"; anything else has to be an amount someone could
// actually have counted — no negatives, nothing below a cent.
function validAmount(value: unknown): value is number | null {
  if (value === null) return true
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-9
}

/**
 * The Kassensturz of one jump day, saved as a draft while the closing dialog
 * is open so a half-finished count survives a closed dialog, a reload, or a
 * switch to another manifest PC.
 */
export function registerDayCloseRoutes(app: FastifyInstance, db: Database) {
  function state(date: string) {
    const exported = db.prepare('SELECT exported_at FROM day_exports WHERE jump_date=?')
      .get(date) as { exported_at: string } | undefined
    return { ...readDayClose(db, date), exportedAt: exported?.exported_at ?? null }
  }

  app.get('/api/day-close/:date', async (req, reply) => {
    const date = (req.params as any).date
    if (!DATE.test(date)) return reply.code(400).send({ error: 'Datum ungültig' })
    return state(date)
  })

  app.put('/api/day-close/:date', async (req, reply) => {
    const date = (req.params as any).date
    if (!DATE.test(date)) return reply.code(400).send({ error: 'Datum ungültig' })
    const body = (req.body ?? {}) as any
    const { countedCash, countedCard, note } = body
    if (!validAmount(countedCash) || !validAmount(countedCard)) {
      return reply.code(400).send({ error: 'Betrag ungültig' })
    }
    // Like the Betriebsleiter name: a missing field is a broken caller, an
    // empty string is an operator who wrote nothing.
    if (typeof note !== 'string') return reply.code(400).send({ error: 'Begründung fehlt' })
    const trimmed = note.trim()
    if (trimmed.length > NOTE_MAX) return reply.code(400).send({ error: 'Begründung zu lang' })

    db.prepare(
      `INSERT INTO day_close (jump_date, counted_cash, counted_card, note, updated_at)
       VALUES (@date, @cash, @card, @note, @now)
       ON CONFLICT(jump_date) DO UPDATE SET counted_cash=@cash, counted_card=@card,
         note=@note, updated_at=@now`
    ).run({ date, cash: countedCash, card: countedCard, note: trimmed, now: new Date().toISOString() })
    return state(date)
  })
}
