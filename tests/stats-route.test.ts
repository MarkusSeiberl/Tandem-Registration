import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'
import { pdfText } from './helpers/pdfText'

// A LAN address: a tablet, a phone, anything that can open the manifest.
const REMOTE = '192.168.0.42'

// After the 2026 season, so 2026 is a past year and compares with all of 2025.
const AFTER_SEASON = new Date(2027, 2, 1)

function server(now: Date = AFTER_SEASON) {
  return testServer({}, undefined, undefined, undefined, undefined, () => now)
}

type Db = ReturnType<typeof testServer>['db']

function seed(db: Db, dates: string[], fields: Record<string, unknown> = {}) {
  const columns = ['first_name', 'jump_date', ...Object.keys(fields)]
  const insert = db.prepare(
    `INSERT INTO registrations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`
  )
  for (const date of dates) insert.run('Gast', date, ...Object.values(fields))
}

function addMaster(db: Db, name: string, active = 1): number {
  return Number(db.prepare('INSERT INTO tandem_masters (name, active) VALUES (?, ?)').run(name, active).lastInsertRowid)
}

test('answers the requested year only', async () => {
  const { app, db } = server()
  seed(db, ['2025-08-01', '2026-06-06', '2026-06-06'])
  const res = await app.inject({ method: 'GET', url: '/api/stats?year=2026' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ year: 2026, tandems: 2, years: [2025, 2026] })
  await app.close()
})

test('without a year it answers the current one', async () => {
  const { app, db } = server(new Date(2026, 6, 1))
  seed(db, ['2026-06-06'])
  const res = await app.inject({ method: 'GET', url: '/api/stats' })
  expect(res.json()).toMatchObject({ year: 2026, tandems: 1 })
  await app.close()
})

test('compares a past year with the whole year before', async () => {
  const { app, db } = server()
  seed(db, ['2025-05-01', '2025-09-01', '2026-06-06'])
  const body = (await app.inject({ method: 'GET', url: '/api/stats?year=2026' })).json()
  expect(body.previous).toMatchObject({ tandems: 2, jumpDays: 2 })
  expect(body.comparedTo).toEqual({ year: 2025, asOf: null })
  await app.close()
})

test('cuts the previous year at the same day while the season runs', async () => {
  const { app, db } = server(new Date(2026, 6, 1))
  seed(db, ['2025-05-01', '2025-07-01', '2025-09-01', '2026-06-06'])
  const body = (await app.inject({ method: 'GET', url: '/api/stats?year=2026' })).json()
  // 1 July itself still counts: the season so far includes today.
  expect(body.previous.tandems).toBe(2)
  expect(body.comparedTo).toEqual({ year: 2025, asOf: '07-01' })
  await app.close()
})

test('previous is null in the first season', async () => {
  const { app, db } = server()
  const anna = addMaster(db, 'Anna')
  seed(db, ['2026-06-06'], { tandem_master_id: anna })
  const body = (await app.inject({ method: 'GET', url: '/api/stats?year=2026' })).json()
  expect(body.previous).toBeNull()
  expect(body.comparedTo).toBeNull()
  expect(body.masters[0].previous).toBeNull()
  await app.close()
})

test("a master's own change against last year", async () => {
  const { app, db } = server()
  const anna = addMaster(db, 'Anna')
  const bert = addMaster(db, 'Bert')
  seed(db, ['2025-06-06', '2025-06-07'], { tandem_master_id: anna })
  seed(db, ['2026-06-06', '2026-06-06', '2026-06-07'], { tandem_master_id: anna })
  seed(db, ['2026-06-06'], { tandem_master_id: bert })
  const masters = (await app.inject({ method: 'GET', url: '/api/stats?year=2026' })).json().masters
  expect(masters).toMatchObject([{ name: 'Anna', previous: 2 }, { name: 'Bert', previous: 0 }])
  await app.close()
})

test('a year without data still answers', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'])
  const res = await app.inject({ method: 'GET', url: '/api/stats?year=2030' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ tandems: 0, years: [2026, 2030] })
  await app.close()
})

test('rejects a malformed year', async () => {
  const { app } = server()
  for (const year of ['26', '2026-06', 'abc']) {
    for (const url of [`/api/stats?year=${year}`, `/api/stats/money?year=${year}`]) {
      const res = await app.inject({ method: 'GET', url })
      expect(res.statusCode).toBe(400)
      expect(res.json()).toEqual({ error: 'Jahr ungültig' })
    }
  }
  await app.close()
})

test('names retired crew', async () => {
  const { app, db } = server()
  const gone = addMaster(db, 'Ehemaliger', 0)
  seed(db, ['2026-06-06'], { tandem_master_id: gone })
  const masters = (await app.inject({ method: 'GET', url: '/api/stats?year=2026' })).json().masters
  expect(masters[0].name).toBe('Ehemaliger')
  await app.close()
})

test('money for the manifest PC, with last year beside it', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'], { payment_method: 'cash', price: 370 })
  seed(db, ['2025-06-06'], { payment_method: 'cash', price: 270 })
  const res = await app.inject({ method: 'GET', url: '/api/stats/money?year=2026' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({
    collected: 370, previous: { collected: 270 }, comparedTo: { year: 2025, asOf: null },
  })
  await app.close()
})

test('no money for the network', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'], { payment_method: 'cash', price: 370 })
  const res = await app.inject({ method: 'GET', url: '/api/stats/money?year=2026', remoteAddress: REMOTE })
  expect(res.statusCode).toBe(403)
  expect(res.json()).toEqual({ error: 'Nur am Manifest-PC verfügbar' })
  await app.close()
})

test('the jump figures are open to the network', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'])
  const res = await app.inject({ method: 'GET', url: '/api/stats?year=2026', remoteAddress: REMOTE })
  expect(res.statusCode).toBe(200)
  await app.close()
})

test('reading statistics freezes no day', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'], { payment_method: 'voucher', voucher_service: 'jump', price: 0 })
  const res = await app.inject({ method: 'GET', url: '/api/stats/money?year=2026' })
  // Valued at the current list price, since the day never froze its own.
  expect(res.json().voucherValue).toBe(270)
  expect(db.prepare('SELECT COUNT(*) AS n FROM day_tables').get()).toEqual({ n: 0 })
  await app.close()
})

test('compares vouchers with what was paid for them', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'], { payment_method: 'voucher', voucher_service: 'jump', price: 0, voucher_amount: 230 })
  const res = await app.inject({ method: 'GET', url: '/api/stats/money?year=2026' })
  expect(res.json().vouchers).toEqual({ count: 1, value: 270, paid: 230, unknown: 0 })
  await app.close()
})

test('serves the report as a PDF with the season and its figures', async () => {
  const { app, db } = server()
  const anna = addMaster(db, 'Anna')
  seed(db, ['2025-06-06'])
  seed(db, ['2026-04-11', '2026-10-24'], { tandem_master_id: anna })
  const res = await app.inject({ method: 'GET', url: '/api/stats/report.pdf?year=2026' })
  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toBe('application/pdf')
  expect(res.headers['content-disposition']).toMatch(/^inline/)
  const text = await pdfText(res.rawPayload)
  expect(text).toContain('Jahresbericht 2026')
  expect(text).toContain('Saison 11. Apr – 24. Okt')
  expect(text).toContain('Vergleich: 2025')
  expect(text).toContain('Anna')
  expect(text).not.toContain('Umsatz')
  await app.close()
})

test('the PDF carries the takings only when asked for on the manifest PC', async () => {
  const { app, db } = server()
  seed(db, ['2026-06-06'], { payment_method: 'cash', price: 370 })
  const local = await pdfText((await app.inject({ method: 'GET', url: '/api/stats/report.pdf?year=2026&money=1' })).rawPayload)
  expect(local).toContain('Umsatz')
  expect(local).toContain('370,00 €')
  const remote = await pdfText((await app.inject({
    method: 'GET', url: '/api/stats/report.pdf?year=2026&money=1', remoteAddress: REMOTE,
  })).rawPayload)
  expect(remote).toContain('Jahresbericht 2026')
  expect(remote).not.toContain('Umsatz')
  expect(remote).not.toContain('370,00 €')
  await app.close()
})

test('a PDF for a year without tandems says so', async () => {
  const { app } = server()
  const res = await app.inject({ method: 'GET', url: '/api/stats/report.pdf?year=2026' })
  expect(res.statusCode).toBe(200)
  expect(await pdfText(res.rawPayload)).toContain('Keine Tandems in 2026.')
  await app.close()
})

test('the PDF rejects a malformed year', async () => {
  const { app } = server()
  const res = await app.inject({ method: 'GET', url: '/api/stats/report.pdf?year=26' })
  expect(res.statusCode).toBe(400)
  await app.close()
})
