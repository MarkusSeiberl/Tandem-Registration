import { test, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { openDb } from '../src/server/db'
import { registerExportRoutes } from '../src/server/routes/export'

const tmpDirs: string[] = []

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-export-test-'))
  tmpDirs.push(dir)
  return dir
}

function makeCfgRef(dir: string, jumpLocation = 'Freistadt') {
  return { current: { exportDir: dir, contractText: '', jumpLocation } }
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
  const today = new Date().toISOString().slice(0, 10)
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
  expect(cell('Zusatz')).toBe('nur Video')

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
