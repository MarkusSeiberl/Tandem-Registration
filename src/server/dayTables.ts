import type Database from 'better-sqlite3'
import type { Config, Payouts, Prices } from './config'

export interface DayTables {
  prices: Prices
  payouts: Payouts
}

/**
 * The price list and payout rates a jump day runs on.
 *
 * A day is frozen by its first registration: whatever the settings say at that
 * moment is copied here, and every row of that day is priced from it — the ones
 * registered at nine in the morning and the ones at six in the evening alike.
 * Editing the price table afterwards is a decision about the next day.
 *
 * This is what stops a price from being three different numbers at once. Before
 * it, the list showed the amount stored on the row, the detail screen recomputed
 * from today's settings, and the payout block in the export used today's rates
 * for a day flown weeks ago. Now all three read the day.
 *
 * The rest of the config — paths, texts, jump location — is not a per-day thing
 * and stays where it is.
 */
const SELECT = 'SELECT prices, payouts FROM day_tables WHERE jump_date=?'

// Amounts that did not exist when older snapshots were written. A frozen day that
// does not name them was flown without them, so they fall back to nothing rather
// than to whatever the settings say today — a re-export of a settled day has to
// keep matching the sheet the club already handed out.
const PAYOUTS_BEFORE: Partial<Payouts> = { weight_over_90: 0, weight_over_100: 0 }

function parse(row: { prices: string; payouts: string }, fallback: DayTables): DayTables {
  return {
    // Spread over the fallback so a snapshot written by an older version, or one
    // missing an amount, cannot take that amount down to undefined.
    prices: { ...fallback.prices, ...safeParse(row.prices) },
    payouts: { ...fallback.payouts, ...PAYOUTS_BEFORE, ...safeParse(row.payouts) },
  }
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function currentOf(cfg: Config): DayTables {
  return { prices: cfg.prices, payouts: cfg.payouts }
}

/**
 * What the day runs on, without starting it.
 *
 * A day nobody has registered on yet answers with the current tables: that is
 * what it would be frozen at, so a screen looking ahead shows the truth. Reading
 * must not create the entry — otherwise clicking through the date picker would
 * freeze a week of empty days at today's prices.
 */
export function tablesForDay(db: Database.Database, jumpDate: string, cfg: Config): DayTables {
  const row = db.prepare(SELECT).get(jumpDate) as { prices: string; payouts: string } | undefined
  return row ? parse(row, currentOf(cfg)) : currentOf(cfg)
}

/** Whether this day has been settled, as opposed to merely quoted at today's tables. */
export function dayIsFrozen(db: Database.Database, jumpDate: string): boolean {
  return db.prepare('SELECT 1 FROM day_tables WHERE jump_date=?').get(jumpDate) !== undefined
}

/**
 * The day's tables, freezing them on this day's first registration.
 *
 * Called from the registration route and nowhere else: a day is started by a
 * guest signing up for it, not by anyone looking at it.
 */
export function startDay(db: Database.Database, jumpDate: string, cfg: Config): DayTables {
  const existing = tablesForDayIfFrozen(db, jumpDate, cfg)
  if (existing) return existing

  const tables = currentOf(cfg)
  db.prepare(
    `INSERT OR IGNORE INTO day_tables (jump_date, prices, payouts)
     VALUES (@jump_date, @prices, @payouts)`
  ).run({
    jump_date: jumpDate,
    prices: JSON.stringify(tables.prices),
    payouts: JSON.stringify(tables.payouts),
  })
  // Read back rather than trusting the insert: a second registration arriving in
  // the same moment may have won, and its tables are the day's.
  return tablesForDay(db, jumpDate, cfg)
}

function tablesForDayIfFrozen(
  db: Database.Database,
  jumpDate: string,
  cfg: Config
): DayTables | null {
  const row = db.prepare(SELECT).get(jumpDate) as { prices: string; payouts: string } | undefined
  return row ? parse(row, currentOf(cfg)) : null
}

/**
 * Moves one day onto today's tables — the deliberate exception, for the day that
 * was already running when someone noticed the price list was wrong.
 *
 * It is never a side effect of anything: the caller is an operator who pressed a
 * button that says so. The registrations of the day are re-priced with it, apart
 * from those carrying a manual correction, which stays the operator's number.
 */
export function repriceDay(
  db: Database.Database,
  jumpDate: string,
  cfg: Config,
  recompute: (row: Record<string, unknown>, prices: Prices) => number
): number {
  const tables = currentOf(cfg)
  db.prepare(
    `INSERT INTO day_tables (jump_date, prices, payouts)
     VALUES (@jump_date, @prices, @payouts)
     ON CONFLICT(jump_date) DO UPDATE SET prices=@prices, payouts=@payouts`
  ).run({
    jump_date: jumpDate,
    prices: JSON.stringify(tables.prices),
    payouts: JSON.stringify(tables.payouts),
  })

  const rows = db
    .prepare('SELECT * FROM registrations WHERE jump_date=? AND COALESCE(price_override,0)=0')
    .all(jumpDate) as Record<string, unknown>[]
  const update = db.prepare('UPDATE registrations SET price=@price WHERE id=@id')
  for (const row of rows) {
    update.run({ id: row.id, price: recompute(row, tables.prices) })
  }
  return rows.length
}
