import { test, expect, afterEach, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { openDb } from '../src/server/db'
import { registerExportRoutes } from '../src/server/routes/export'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'
import { redeemVoucher } from '../src/server/voucherRedeem'
import type { SseHub } from '../src/server/sse'

// The Gutscheinliste is mocked here so a test can hold an export in the middle
// of its voucher sweep: that is where it spends its seconds in production, and
// where a second press or a second PC would meet it.
vi.mock('../src/server/voucherRedeem', () => ({ redeemVoucher: vi.fn() }))

const DATE = '2026-07-09'
const tmpDirs: string[] = []

beforeEach(() => {
  vi.mocked(redeemVoucher).mockReset()
  vi.mocked(redeemVoucher).mockResolvedValue('written')
})

afterEach(async () => {
  while (tmpDirs.length) await fs.rm(tmpDirs.pop()!, { recursive: true, force: true })
})

async function setup(options: { manager?: string | null; vouchers?: number } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-close-test-'))
  tmpDirs.push(dir)
  const db = openDb(':memory:')
  const manager = options.manager === undefined ? 'Max Muster' : options.manager
  if (manager !== null) db.prepare('INSERT INTO day_manager (jump_date,name) VALUES (?,?)').run(DATE, manager)
  // 1 300 € in cash, 548 € by card, both collected.
  db.prepare(`INSERT INTO registrations (first_name,last_name,price,payment_method,created_at,jump_date,paid_at)
    VALUES ('A','Bar',1300,'cash','2026-07-09T10:00:00Z',?, '2026-07-09T12:00:00Z')`).run(DATE)
  db.prepare(`INSERT INTO registrations (first_name,last_name,price,payment_method,created_at,jump_date,paid_at)
    VALUES ('B','Karte',548,'card','2026-07-09T10:00:00Z',?, '2026-07-09T12:00:00Z')`).run(DATE)
  for (let i = 0; i < (options.vouchers ?? 0); i++) {
    db.prepare(`INSERT INTO registrations
      (first_name,last_name,price,payment_method,voucher_number,created_at,jump_date,paid_at,voucher_redeemed_at)
      VALUES ('V','G',0,'voucher',?, '2026-07-09T10:00:00Z',?, '2026-07-09T12:00:00Z','2026-07-09T12:00:00Z')`)
      .run(`26-00${i}`, DATE)
  }
  const sse = { broadcast: vi.fn() }
  const app = Fastify()
  registerExportRoutes(app, db, {
    current: {
      exportDir: dir, contractText: '', privacyText: '', jumpLocation: 'Freistadt', backupDir: '',
      voucherListPath: 'list.xlsx', prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
    },
  }, sse as unknown as SseHub)
  return { app, db, dir, sse }
}

function count(db: ReturnType<typeof openDb>, cash: number | null, card: number | null, note: string) {
  db.prepare(`INSERT INTO day_close (jump_date,counted_cash,counted_card,note,updated_at)
    VALUES (?,?,?,?,'2026-07-09T18:00:00Z')`).run(DATE, cash, card, note)
}

async function sheetLines(dir: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${DATE}.xlsx`))
  const lines: [unknown, unknown][] = []
  wb.worksheets[0].eachRow((r) => lines.push([r.getCell(1).value, r.getCell(2).value]))
  return lines
}

const post = (app: ReturnType<typeof Fastify>, query = '') =>
  app.inject({ method: 'POST', url: `/api/export?date=${DATE}${query}` })

test('a day without a Betriebsleiter is not closed', async () => {
  const { app, db, dir } = await setup({ manager: null })
  const res = await post(app)
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'Betriebsleiter fehlt' })
  expect(db.prepare('SELECT * FROM day_exports').all()).toEqual([])
  await expect(fs.stat(path.join(dir, `Tandem_${DATE}.xlsx`))).rejects.toThrow()
  await app.close()
})

test('a till that differs needs a reason before the day is closed', async () => {
  const { app, db } = await setup()
  count(db, 1305, 548, '')
  const res = await post(app)
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'Begründung für die Kassendifferenz fehlt' })
  expect(db.prepare('SELECT * FROM day_exports').all()).toEqual([])
  await app.close()
})

test('a till that differs with a reason closes the day', async () => {
  const { app, db } = await setup()
  count(db, 1305, 548, 'x')
  expect((await post(app)).statusCode).toBe(200)
  await app.close()
})

test('a till nobody counted never needs a reason', async () => {
  const { app, db } = await setup()
  count(db, null, 548, '')
  expect((await post(app)).statusCode).toBe(200)
  await app.close()
})

test('the sheet carries the Kassensturz against its own sums', async () => {
  const { app, db, dir } = await setup()
  count(db, 1305, 548, 'Trinkgeld')
  await post(app)
  const lines = await sheetLines(dir)
  const start = lines.findIndex(([label]) => label === 'Kassensturz')
  expect(lines.slice(start + 1, start + 6)).toEqual([
    ['Gezählt Bar', 1305], ['Differenz Bar', 5],
    ['Gezählt Karte', 548], ['Differenz Karte', 0],
    ['Begründung', 'Trinkgeld'],
  ])
  await app.close()
})

test('a plain day nobody counted still gets the block, and reports its progress', async () => {
  const { app, dir, sse } = await setup()
  const res = await post(app, '&run=abc')
  expect(res.statusCode).toBe(200)
  const lines = await sheetLines(dir)
  expect(lines).toContainEqual(['Gezählt Bar', 'nicht gezählt'])
  expect(lines).toContainEqual(['Gezählt Karte', 'nicht gezählt'])
  expect(sse.broadcast.mock.calls).toEqual([
    ['export-progress', { run: 'abc', date: DATE, phase: 'vouchers', done: 0, total: 0 }],
    ['export-progress', { run: 'abc', date: DATE, phase: 'sheet' }],
  ])
  await app.close()
})

test('progress counts every voucher written, then the sheet', async () => {
  const { app, sse } = await setup({ vouchers: 2 })
  await post(app, '&run=abc')
  expect(sse.broadcast.mock.calls).toEqual([
    ['export-progress', { run: 'abc', date: DATE, phase: 'vouchers', done: 0, total: 2 }],
    ['export-progress', { run: 'abc', date: DATE, phase: 'vouchers', done: 1, total: 2 }],
    ['export-progress', { run: 'abc', date: DATE, phase: 'vouchers', done: 2, total: 2 }],
    ['export-progress', { run: 'abc', date: DATE, phase: 'sheet' }],
  ])
  await app.close()
})

test('an export without a run id reports nothing', async () => {
  const { app, sse } = await setup({ vouchers: 1 })
  await post(app)
  expect(sse.broadcast).not.toHaveBeenCalled()
  await app.close()
})

test.each(['x'.repeat(65), 'a b', 'a/b'])('a malformed run id %s is refused', async (run) => {
  const { app } = await setup()
  const res = await post(app, `&run=${encodeURIComponent(run)}`)
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'Lauf-Kennung ungültig' })
  await app.close()
})

test('a second export of the same day waits its turn, and the lock is released after', async () => {
  const { app } = await setup({ vouchers: 1 })
  let release!: () => void
  vi.mocked(redeemVoucher).mockImplementationOnce(
    () => new Promise((resolve) => { release = () => resolve('written') }))

  const first = post(app)
  await vi.waitFor(() => expect(redeemVoucher).toHaveBeenCalledTimes(1))
  const second = await post(app)
  expect(second.statusCode).toBe(409)
  expect(second.json()).toEqual({ error: 'Tagesabschluss läuft bereits' })

  release()
  expect((await first).statusCode).toBe(200)
  expect((await post(app)).statusCode).toBe(200)
  await app.close()
})

test('a failed export releases the lock too', async () => {
  const { app, dir } = await setup()
  // A file where the export folder should be: the sheet cannot be written.
  const blocked = path.join(dir, 'blocked')
  await fs.writeFile(blocked, '')
  const app2 = Fastify()
  const db = openDb(':memory:')
  db.prepare('INSERT INTO day_manager (jump_date,name) VALUES (?,?)').run(DATE, 'Max Muster')
  registerExportRoutes(app2, db, {
    current: {
      exportDir: path.join(blocked, 'sub'), contractText: '', privacyText: '', jumpLocation: '', backupDir: '',
      voucherListPath: '', prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
    },
  })
  expect((await post(app2)).statusCode).toBe(500)
  expect((await post(app2)).statusCode).toBe(500)  // not 409: the lock went with the failure
  await app.close()
  await app2.close()
})

// An open tandem can already name its till (Zahlungsart saved on the detail
// screen before Kassieren). That money is not in the till yet, so the count is
// held against collected money only — what the dialog and the toolbar show.
test('an open tandem that already names its till is not expected in the till', async () => {
  const { app, db, dir } = await setup()
  db.prepare(`INSERT INTO registrations (first_name,last_name,price,payment_method,created_at,jump_date)
    VALUES ('C','Offen',230,'cash','2026-07-09T10:00:00Z',?)`).run(DATE)
  count(db, 1300, 548, '')
  expect((await post(app)).statusCode).toBe(200)
  const lines = await sheetLines(dir)
  expect(lines).toContainEqual(['Differenz Bar', 0])
  await app.close()
})
