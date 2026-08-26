import { test, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { openDb } from '../src/server/db'
import { registerExportRoutes } from '../src/server/routes/export'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'
import { writeVoucherFile } from './helpers/voucherFile'
import { clearVoucherListCache } from '../src/server/voucherList'
import { today as localToday } from '../src/server/day'

const tmpDirs: string[] = []

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-export-test-'))
  tmpDirs.push(dir)
  return dir
}

function makeCfgRef(dir: string, jumpLocation = 'Freistadt', voucherListPath = '') {
  return {
    current: {
      exportDir: dir, contractText: '', privacyText: '', jumpLocation, backupDir: '',
      voucherListPath,
      prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
    },
  }
}

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop()!
    await fs.rm(dir, { recursive: true, force: true })
  }
})

const CONTRACT_PDF_FILENAME = '2026.07.09_B-A.pdf'

// Layout is fixed: 3 meta rows (Datum/Ort/Betriebsleiter) + 1 blank spacer,
// so the column header row and first data row always land here.
const HEADER_ROW = 5
const FIRST_DATA_ROW = 6

function seed(db: ReturnType<typeof openDb>, date: string) {
  const masterId = db.prepare('INSERT INTO tandem_masters (name,active) VALUES (?,1)').run('Hans').lastInsertRowid
  const flyerId = db.prepare('INSERT INTO camera_flyers (name,active) VALUES (?,1)').run('Peter').lastInsertRowid
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,gender,age,height_cm,weight_kg,
     street,postal_code,city,email,phone,contract_pdf_filename,
     accepted_terms,tandem_master_id,load_number,price,payment_method,extra_booking,
     camera_flyer_id,created_at,jump_date)
    VALUES ('A','B','female',30,170,80,
     'X 1','4240','Freistadt','a@b.de','0660',?,
     1,?,3,199.5,'cash','video',?,?,?)`)
    .run(CONTRACT_PDF_FILENAME, masterId, flyerId, new Date().toISOString(), date)
  return { masterId, flyerId }
}

test('POST /api/export writes an xlsx file with resolved names, no contract_pdf_filename', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  seed(db, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.count).toBe(1)

  const expectedPath = path.join(dir, `Tandem_${date}.xlsx`)
  expect(body.path).toBe(expectedPath)

  const stat = await fs.stat(expectedPath)
  expect(stat.isFile()).toBe(true)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(expectedPath)
  const ws = wb.worksheets[0]
  const headers = (ws.getRow(HEADER_ROW).values as any[]).slice(1)
  expect(headers).not.toContain('contract_pdf_filename')
  expect(headers).not.toContain('Alter')
  expect(headers).not.toContain('Größe (cm)')
  expect(headers).not.toContain('Gewicht (kg)')
  expect(headers).toContain('Adresse')

  const row = ws.getRow(FIRST_DATA_ROW).values as any[]
  expect(row).toContain('A')
  expect(row).toContain('Hans')
  expect(row).toContain('Peter')
  expect(row).toContain('X 1, 4240, Freistadt')

  const allValues: any[] = []
  ws.eachRow(r => allValues.push(r.values))
  const serialized = JSON.stringify(allValues)
  expect(serialized).not.toContain(CONTRACT_PDF_FILENAME)

  await app.close()
})

test('POST /api/export writes Datum/Ort/Betriebsleiter meta rows, BL left blank', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  seed(db, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir, 'Freistadt'))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]

  expect(ws.getRow(1).getCell(1).value).toBe('Datum')
  expect(ws.getRow(1).getCell(2).value).toBe(date)
  expect(ws.getRow(2).getCell(1).value).toBe('Ort')
  expect(ws.getRow(2).getCell(2).value).toBe('Freistadt')
  expect(ws.getRow(3).getCell(1).value).toBe('Betriebsleiter (BL)')
  expect(ws.getRow(3).getCell(2).value ?? '').toBe('')

  await app.close()
})

test('POST /api/export defaults to today and creates the export dir if missing', async () => {
  const db = openDb(':memory:')
  const today = localToday()
  seed(db, today)

  const base = await makeTmpDir()
  const dir = path.join(base, 'nested', 'export')
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const res = await app.inject({ method: 'POST', url: '/api/export' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.count).toBe(1)
  expect(body.path).toBe(path.join(dir, `Tandem_${today}.xlsx`))

  const stat = await fs.stat(body.path)
  expect(stat.isFile()).toBe(true)

  await app.close()
})

test('POST /api/export overwrites an existing file for the same date', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  seed(db, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const filePath = path.join(dir, `Tandem_${date}.xlsx`)
  await fs.writeFile(filePath, 'not a real workbook')

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })
  expect(res.statusCode).toBe(200)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  expect(wb.worksheets[0].getRow(FIRST_DATA_ROW).getCell(1).value).toBe('A')

  await app.close()
})

test('POST /api/export leaves master/flyer as empty string when unmatched', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,gender,age,height_cm,weight_kg,
     street,postal_code,city,email,phone,contract_pdf_filename,
     accepted_terms,tandem_master_id,load_number,price,payment_method,extra_booking,
     camera_flyer_id,created_at,jump_date)
    VALUES ('NoMatch','B','female',30,170,80,
     'X 1','4240','Freistadt','a@b.de','0660','2026.07.09_B-NoMatch.pdf',
     1,9999,3,199.5,'cash','video',8888,?,?)`)
    .run(new Date().toISOString(), date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })
  expect(res.statusCode).toBe(200)

  const filePath = path.join(dir, `Tandem_${date}.xlsx`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const ws = wb.worksheets[0]
  const cols = ws.getRow(HEADER_ROW).values as any[]
  const masterIdx = cols.findIndex(v => v === 'Tandemmaster')
  const flyerIdx = cols.findIndex(v => v === 'Kameraflieger')
  const row = ws.getRow(FIRST_DATA_ROW).values as any[]
  expect(row[masterIdx] ?? '').toBe('')
  expect(row[flyerIdx] ?? '').toBe('')

  await app.close()
})

test('POST /api/export writes German labels, never raw enum values', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  seed(db, date) // gender 'female', payment 'cash', extra 'video'

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]
  const headers = ws.getRow(HEADER_ROW).values as any[]
  const cell = (header: string) => (ws.getRow(FIRST_DATA_ROW).values as any[])[headers.indexOf(header)]

  expect(cell('Geschlecht')).toBe('weiblich')
  expect(cell('Zahlungsart')).toBe('Bar')
  expect(cell('Leistung')).toBe('Sprung+Video')

  // The stored enum values must not reach the sheet in any column.
  const dumped: any[] = []
  ws.eachRow(r => dumped.push(r.values))
  const serialized = JSON.stringify(dumped)
  for (const raw of ['female', 'cash', 'video_photo', '"video"']) {
    expect(serialized).not.toContain(raw)
  }

  await app.close()
})

test('POST /api/export leaves an unknown enum value as an empty cell', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  // NULL payment/extra/gender is normal for a freshly registered guest the
  // manifest has not touched yet.
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,age,weight_kg,street,postal_code,city,email,phone,
     accepted_terms,created_at,jump_date)
    VALUES ('Neu','Gast',30,80,'X 1','4240','Freistadt','a@b.de','0660',1,?,?)`)
    .run(new Date().toISOString(), date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })
  expect(res.statusCode).toBe(200)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]
  const headers = ws.getRow(HEADER_ROW).values as any[]
  const cell = (header: string) => (ws.getRow(FIRST_DATA_ROW).values as any[])[headers.indexOf(header)] ?? ''

  expect(cell('Geschlecht')).toBe('')
  expect(cell('Zahlungsart')).toBe('')

  await app.close()
})

test('POST /api/export labels the voucher service and the weight surcharge', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,age,weight_kg,street,postal_code,city,email,phone,
     accepted_terms,price,payment_method,voucher_number,voucher_service,
     extra_booking,weight_surcharge,created_at,jump_date)
    VALUES ('Gut','Schein',30,95,'X 1','4240','Freistadt','a@b.de','0660',1,
     60,'voucher','GS-1','jump_video','video_photo','over_90',?,?)`)
    .run(new Date().toISOString(), date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]
  const headers = ws.getRow(HEADER_ROW).values as any[]
  const cell = (header: string) => (ws.getRow(FIRST_DATA_ROW).values as any[])[headers.indexOf(header)]

  expect(cell('Gutschein-Leistung')).toBe('Sprung+Video')
  expect(cell('Zuschlag')).toBe('ab 90 kg')
  expect(cell('Preis')).toBe(60)

  const dumped: any[] = []
  ws.eachRow(r => dumped.push(r.values))
  expect(JSON.stringify(dumped)).not.toContain('jump_video')
  expect(JSON.stringify(dumped)).not.toContain('over_90')

  await app.close()
})

test('POST /api/export sums the takings by the till the money landed in', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  const insert = db.prepare(`INSERT INTO registrations
    (first_name,last_name,age,weight_kg,street,postal_code,city,email,phone,
     accepted_terms,price,payment_method,voucher_payment_method,created_at,jump_date)
    VALUES (?,'B',30,80,'X 1','4240','Freistadt','a@b.de','0660',1,?,?,?,?,?)`)
  const now = new Date().toISOString()
  insert.run('Bar1', 410, 'cash', null, now, date)
  insert.run('Bar2', 270, 'cash', null, now, date)
  insert.run('Karte', 390, 'card', null, now, date)
  // Voucher rows carry only the top-up — and that top-up was handed over in cash
  // or on a card like any other, so it belongs in that till.
  insert.run('GutscheinBar', 100, 'voucher', 'cash', now, date)
  insert.run('GutscheinKarte', 60, 'voucher', 'card', now, date)
  // Not yet manifested: the amount belongs to the day but to no till yet.
  insert.run('Offen', 270, null, null, now, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]

  const totals = new Map<string, any>()
  ws.eachRow(r => {
    const label = r.getCell(1).value
    if (typeof label === 'string' && (label.startsWith('Summe') || label === 'Gesamt' ||
        label.startsWith('davon'))) {
      totals.set(label, r.getCell(2).value)
    }
  })

  expect(totals.get('Summe Bar')).toBe(780)
  expect(totals.get('Summe Karte')).toBe(450)
  expect(totals.get('Summe ohne Zahlungsart')).toBe(270)
  expect(totals.get('Gesamt')).toBe(1500)
  expect(totals.get('davon Gutschein-Zuzahlung')).toBe(160)

  // The three tills have to account for every euro of the day.
  expect(totals.get('Summe Bar') + totals.get('Summe Karte') + totals.get('Summe ohne Zahlungsart'))
    .toBe(totals.get('Gesamt'))

  await app.close()
})

test('POST /api/export labels the till a voucher top-up was paid into', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,age,weight_kg,street,postal_code,city,email,phone,
     accepted_terms,price,payment_method,voucher_payment_method,created_at,jump_date)
    VALUES ('Gut','Schein',30,80,'X 1','4240','Freistadt','a@b.de','0660',1,
     100,'voucher','cash',?,?)`)
    .run(new Date().toISOString(), date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]
  const headers = ws.getRow(HEADER_ROW).values as any[]
  const cell = (header: string) => (ws.getRow(FIRST_DATA_ROW).values as any[])[headers.indexOf(header)]

  expect(cell('Zahlungsart')).toBe('Gutschein')
  expect(cell('Zuzahlung mit')).toBe('Bar')

  await app.close()
})

test('POST /api/export appends what each tandemmaster and video flyer earned', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  const hans = db.prepare('INSERT INTO tandem_masters (name,active) VALUES (?,1)').run('Hans').lastInsertRowid
  const anna = db.prepare('INSERT INTO tandem_masters (name,active) VALUES (?,1)').run('Anna').lastInsertRowid
  const peter = db.prepare('INSERT INTO camera_flyers (name,active) VALUES (?,1)').run('Peter').lastInsertRowid
  const insert = db.prepare(`INSERT INTO registrations
    (first_name,last_name,age,weight_kg,street,postal_code,city,email,phone,
     accepted_terms,price,payment_method,extra_booking,tandem_master_id,camera_flyer_id,
     created_at,jump_date)
    VALUES (?,'B',30,80,'X 1','4240','Freistadt','a@b.de','0660',1,?,?,?,?,?,?,?)`)
  const now = new Date().toISOString()
  insert.run('Eins', 270, 'cash', 'none', hans, null, now, date)
  insert.run('Zwei', 370, 'cash', 'video', hans, peter, now, date)
  insert.run('Drei', 390, 'card', 'video_photo', anna, peter, now, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]

  const lines: [any, any, any][] = []
  ws.eachRow(r => lines.push([r.getCell(1).value, r.getCell(2).value, r.getCell(3).value]))

  expect(lines).toContainEqual(['Vergütung Tandemmaster', null, null])
  expect(lines).toContainEqual(['Hans', '2 × 45,00 €', 90])
  expect(lines).toContainEqual(['Anna', '1 × 45,00 €', 45])
  expect(lines).toContainEqual(['Vergütung Kameraflieger', null, null])
  expect(lines).toContainEqual(['Peter', '1 × 60,00 € + 1 × 80,00 €', 140])
  // Both sections close with their own Summe.
  expect(lines.filter(l => l[0] === 'Summe').map(l => l[2])).toEqual([135, 140])

  await app.close()
})

test('POST /api/export rejects a path-traversal date and touches no file outside the export dir', async () => {
  const db = openDb(':memory:')
  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const res = await app.inject({ method: 'POST', url: '/api/export?date=../../etc/passwd' })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'Datum ungültig' })

  const entries = await fs.readdir(dir).catch(() => [] as string[])
  expect(entries).toHaveLength(0)

  await app.close()
})

test('POST /api/export still works with a valid ?date=YYYY-MM-DD', async () => {
  const db = openDb(':memory:')
  const date = '2026-07-09'
  seed(db, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(body.count).toBe(1)
  expect(body.path).toBe(path.join(dir, `Tandem_${date}.xlsx`))

  await app.close()
})

test('the export writes redemptions that could not be written earlier', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const db = openDb(':memory:')
  const date = '2026-08-10'

  // A row collected while the file was locked: redeemed for us, not yet written.
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,payment_method,voucher_number,price,
     created_at,jump_date,paid_at,voucher_redeemed_at)
    VALUES ('A','B','voucher','26-001',20,
     '2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z',
     '2026-08-10T10:00:00.000Z')`).run()

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir, 'Freistadt', voucherListPath))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  expect(res.json().redemptionsWritten).toBe(1)
  expect(res.json().redemptionsPending).toBe(0)
  const row = db.prepare('SELECT voucher_redeem_synced_at FROM registrations').get() as any
  expect(row.voucher_redeem_synced_at).not.toBeNull()
  await app.close()
})

test('the export writes a redemption left over from an earlier day', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const db = openDb(':memory:')

  // Collected on Saturday while the file was locked. Sunday's banner counts it,
  // so Sunday's export has to be able to write it off — otherwise the count can
  // never reach zero and nobody is told to go back and re-export Saturday.
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,payment_method,voucher_number,price,
     created_at,jump_date,paid_at,voucher_redeemed_at)
    VALUES ('Sams','Tag','voucher','26-002',20,
     '2026-08-08T10:00:00.000Z','2026-08-08','2026-08-08T10:00:00.000Z',
     '2026-08-08T10:00:00.000Z')`).run()

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir, 'Freistadt', voucherListPath))

  const res = await app.inject({ method: 'POST', url: '/api/export?date=2026-08-09' })

  // Sunday has no registrations of its own; the redemption is picked up anyway.
  expect(res.json().count).toBe(0)
  expect(res.json().redemptionsWritten).toBe(1)
  expect(res.json().redemptionsPending).toBe(0)
  const row = db.prepare('SELECT voucher_redeem_synced_at FROM registrations').get() as any
  expect(row.voucher_redeem_synced_at).not.toBeNull()
  await app.close()
})

test('a redemption that throws on its way to the file still leaves an export behind', async () => {
  const db = openDb(':memory:')
  const date = '2026-08-10'
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,payment_method,voucher_number,price,
     created_at,jump_date,paid_at,voucher_redeemed_at)
    VALUES ('A','B','voucher','26-001',20,
     '2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z',
     '2026-08-10T10:00:00.000Z')`).run()

  const dir = await makeTmpDir()
  const app = Fastify()
  // A non-string path reaches `cfg.voucherListPath?.trim()` in redeemVoucher,
  // which sits outside that function's own try — and the settings route spreads
  // the request body in without type-checking this key, so it is reachable.
  // Nothing about a voucher may cost the club the day's export.
  registerExportRoutes(app, db, makeCfgRef(dir, 'Freistadt', 42 as any))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  expect(res.statusCode).toBe(200)
  const stat = await fs.stat(path.join(dir, `Tandem_${date}.xlsx`))
  expect(stat.isFile()).toBe(true)
  // Counted as still open, so the next export tries the row again.
  expect(res.json().redemptionsPending).toBe(1)
  const row = db.prepare('SELECT voucher_redeemed_at FROM registrations').get() as any
  expect(row.voucher_redeemed_at).not.toBeNull()
  await app.close()
})

test('a voucher that turned invalid leaves the queue instead of blocking it', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
  ])
  const db = openDb(':memory:')
  const date = '2026-08-10'

  db.prepare(`INSERT INTO registrations
    (first_name,last_name,payment_method,voucher_number,price,
     created_at,jump_date,paid_at,voucher_redeemed_at)
    VALUES ('A','B','voucher','26-007',20,
     '2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z',
     '2026-08-10T10:00:00.000Z')`).run()

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir, 'Freistadt', voucherListPath))

  const res = await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  expect(res.json().redemptionsInvalid).toBe(1)
  expect(res.json().redemptionsPending).toBe(0)
  // Taken back, so it stops being counted as owed to the file.
  const row = db.prepare('SELECT voucher_redeemed_at FROM registrations').get() as any
  expect(row.voucher_redeemed_at).toBeNull()
  await app.close()
})
