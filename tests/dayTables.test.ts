import { test, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { testServer } from './helpers/testServer'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'
// The server files a jump under its local day, so the tests have to ask the
// same question the same way — see src/server/day.ts.
import { today } from '../src/server/day'
import { openDb } from '../src/server/db'
import { tablesForDay } from '../src/server/dayTables'

// What a jump costs is a fact of the day it was flown. The price table in the
// settings is where the NEXT day starts from — it is not a retroactive opinion
// about days already flown. Before this, the list showed the amount stored on
// the row, the detail screen recomputed from today's settings, and the payout
// block used today's rates for a day flown weeks ago.

const guest = (overrides: Record<string, unknown> = {}) => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  accepted_terms: true, privacy_ack: true,
  ...overrides,
})

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-day-'))
}

function server(prices: Partial<typeof DEFAULT_PRICES> = {}) {
  return testServer({ exportDir: tmpDir(), prices: { ...DEFAULT_PRICES, ...prices } })
}

async function register(app: any, overrides: Record<string, unknown> = {}): Promise<number> {
  const res = await app.inject({
    method: 'POST', url: '/api/registrations', payload: guest(overrides),
  })
  expect(res.statusCode).toBe(201)
  return res.json().id
}

test('the first registration of a day freezes that day price list', async () => {
  const { app, db } = server({ jump: 270 })
  await register(app)

  const row = db.prepare('SELECT * FROM day_tables').get() as any
  expect(row.jump_date).toBe(today())
  expect(JSON.parse(row.prices).jump).toBe(270)
  expect(JSON.parse(row.payouts)).toEqual(DEFAULT_PAYOUTS)
})

test('a price change mid-day leaves the running day where it is', async () => {
  const { app, cfgRef } = server({ jump: 270 })
  await register(app)

  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }
  const second = await register(app)

  const res = await app.inject({ method: 'GET', url: '/api/registrations' })
  const prices = res.json().map((r: any) => r.price)
  // Both guests of this day pay what the day costs, the one who signed before
  // the change and the one who signed after it.
  expect(prices).toEqual([270, 270])
  expect(res.json().find((r: any) => r.id === second).price).toBe(270)
})

test('a day with no registrations yet simply takes the new prices', async () => {
  const { app, cfgRef, db } = server({ jump: 270 })

  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }
  // Nothing was frozen, because nobody had registered.
  expect(db.prepare('SELECT COUNT(*) c FROM day_tables').get()).toEqual({ c: 0 })

  await register(app)
  expect((await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0].price).toBe(280)
})

test('saving an unrelated field does not re-price the row at the new table', async () => {
  // The bug all of this is about: pressing Speichern to set a load number used
  // to move a row onto today's prices, silently.
  const { app, cfgRef } = server({ jump: 270 })
  const id = await register(app)
  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }

  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    // Exactly what the detail screen sends on every save.
    payload: { load_number: 3, extra_booking: 'none', weight_surcharge: 'none', price_override: 0 },
  })
  expect(res.json().price).toBe(270)
})

test('adding a video prices it from the day list, not from the new one', async () => {
  const { app, cfgRef } = server({ jump: 270, video: 100 })
  const id = await register(app)
  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280, video: 120 }

  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { extra_booking: 'video' },
  })
  expect(res.json().price).toBe(370)
})

test('the weight surcharge follows the day list as well', async () => {
  const { app, cfgRef } = server({ jump: 270, weight_over_90: 30 })
  const id = await register(app, { weight_kg: 95 })
  cfgRef.current.prices = { ...cfgRef.current.prices, weight_over_90: 50 }

  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { extra_booking: 'none' },
  })
  expect(res.json().price).toBe(300)
})

test('the day tables endpoint reports what the day runs on and what changed', async () => {
  const { app, cfgRef } = server({ jump: 270 })
  await register(app)
  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }

  const res = await app.inject({ method: 'GET', url: `/api/day-tables/${today()}` })
  expect(res.json().prices.jump).toBe(270)
  expect(res.json().current.prices.jump).toBe(280)
  expect(res.json().frozen).toBe(true)
})

test('a day nobody has registered on is quoted, not settled', async () => {
  const { app } = server({ jump: 270 })
  const res = await app.inject({ method: 'GET', url: '/api/day-tables/2026-12-24' })
  expect(res.json().frozen).toBe(false)
  expect(res.json().prices.jump).toBe(270)
})

test('the day tables endpoint refuses something that is not a date', async () => {
  const { app } = server()
  expect((await app.inject({ method: 'GET', url: '/api/day-tables/gestern' })).statusCode).toBe(400)
})

test('repricing a day moves every row of it, and nothing of another day', async () => {
  const { app, cfgRef, db } = server({ jump: 270 })
  await register(app)
  await register(app)
  // A row from a day that is already over must not move.
  db.prepare(
    `INSERT INTO registrations (first_name,last_name,weight_kg,jump_date,price,price_override)
     VALUES ('Alt','Gast',80,'2026-07-09',250,0)`
  ).run()

  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }
  const res = await app.inject({ method: 'POST', url: `/api/day-tables/${today()}/reprice` })
  expect(res.json().updated).toBe(2)

  const rows = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  expect(rows.map((r: any) => r.price)).toEqual([280, 280])
  expect(
    (db.prepare('SELECT price FROM registrations WHERE jump_date=?').get('2026-07-09') as any).price
  ).toBe(250)
})

test('a day that is over cannot be repriced at all', async () => {
  // The amounts of a past day were collected from real guests and usually
  // exported already. Editing the price list afterwards is about coming days,
  // never about that one — and the server says so rather than trusting the
  // manifest to hide its button.
  const { app, cfgRef, db } = server({ jump: 270 })
  db.prepare(
    `INSERT INTO registrations (first_name,last_name,weight_kg,jump_date,price,price_override)
     VALUES ('Alt','Gast',80,'2026-07-09',270,0)`
  ).run()
  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }

  const res = await app.inject({ method: 'POST', url: '/api/day-tables/2026-07-09/reprice' })
  expect(res.statusCode).toBe(409)
  expect(
    (db.prepare('SELECT price FROM registrations WHERE jump_date=?').get('2026-07-09') as any).price
  ).toBe(270)
})

test('repricing a day leaves a manually corrected row alone', async () => {
  const { app, cfgRef } = server({ jump: 270 })
  const id = await register(app)
  await app.inject({ method: 'PATCH', url: `/api/registrations/${id}`, payload: { price: 199 } })

  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 280 }
  await app.inject({ method: 'POST', url: `/api/day-tables/${today()}/reprice` })

  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]
  // Somebody decided this number on purpose; a price list does not overrule that.
  expect(row.price).toBe(199)
})

test('repricing a day carries the payout rates with it', async () => {
  const { app, cfgRef, db } = server({ jump: 270 })
  await register(app)
  cfgRef.current.payouts = { ...cfgRef.current.payouts, tandem_master: 55 }

  await app.inject({ method: 'POST', url: `/api/day-tables/${today()}/reprice` })

  const row = db.prepare('SELECT payouts FROM day_tables WHERE jump_date=?').get(today()) as any
  expect(JSON.parse(row.payouts).tandem_master).toBe(55)
})

test('the export pays the crew at the rates of the day it exports', async () => {
  const dir = tmpDir()
  const { app, cfgRef, db } = testServer({
    exportDir: dir,
    prices: { ...DEFAULT_PRICES },
    payouts: { ...DEFAULT_PAYOUTS, tandem_master: 45 },
  })
  await register(app)
  cfgRef.current.payouts = { ...cfgRef.current.payouts, tandem_master: 90 }

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${today()}` })
  expect(res.statusCode).toBe(200)

  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(res.json().path)
  const sheet = wb.worksheets[0]
  let found = ''
  sheet.eachRow((row) => {
    const first = String(row.getCell(1).value ?? '')
    if (first.includes('Vergütung')) found = 'section'
    if (found && String(row.getCell(2).value ?? '').includes('×')) {
      found = String(row.getCell(2).value)
    }
  })
  // The day was flown at 45, and raising the rate afterwards does not rewrite it.
  expect(found).toContain('45,00 €')
  fs.rmSync(dir, { recursive: true, force: true })
})

// A snapshot written before the weight bonus existed does not name it. Spreading
// it over today's config — which is what makes an incomplete snapshot safe for
// every other amount — would make a re-export of that day pay a bonus nobody
// agreed to and nobody handed over.
test('a day frozen before the weight bonus existed pays none of it', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO day_tables (jump_date, prices, payouts) VALUES (?,?,?)').run(
    '2026-08-01',
    JSON.stringify(DEFAULT_PRICES),
    JSON.stringify({ tandem_master: 45, video: 60, video_photo: 80 }),
  )
  const cfg = { prices: DEFAULT_PRICES, payouts: DEFAULT_PAYOUTS } as any

  const tables = tablesForDay(db, '2026-08-01', cfg)

  expect(tables.payouts.weight_over_90).toBe(0)
  expect(tables.payouts.weight_over_100).toBe(0)
  // Every other amount still falls back to today's config, as before.
  expect(tables.payouts.tandem_master).toBe(45)
  expect(tables.prices).toEqual(DEFAULT_PRICES)
})

test('a snapshot that names the weight bonus keeps its own amounts', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO day_tables (jump_date, prices, payouts) VALUES (?,?,?)').run(
    '2026-08-02',
    JSON.stringify(DEFAULT_PRICES),
    JSON.stringify({ ...DEFAULT_PAYOUTS, weight_over_90: 20 }),
  )
  const cfg = { prices: DEFAULT_PRICES, payouts: DEFAULT_PAYOUTS } as any

  expect(tablesForDay(db, '2026-08-02', cfg).payouts.weight_over_90).toBe(20)
})

test('a day with no snapshot at all is quoted at today rates, bonus included', () => {
  const db = openDb(':memory:')
  const cfg = { prices: DEFAULT_PRICES, payouts: DEFAULT_PAYOUTS } as any

  expect(tablesForDay(db, '2026-08-03', cfg).payouts.weight_over_90).toBe(15)
})
