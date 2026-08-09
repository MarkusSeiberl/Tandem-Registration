import { test, expect, afterEach } from 'vitest'
import { createRequire } from 'node:module'
import Database from 'better-sqlite3'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { openDb } from '../src/server/db'

// The packaged .exe loads better-sqlite3's native binary from an explicit path
// beside the exe (main.ts passes `nativeBinding`), because pkg can't serve a
// .node out of its virtual snapshot. These tests prove openDb actually forwards
// the nativeBinding argument instead of silently ignoring it.
const realBinding = createRequire(import.meta.url)
  .resolve('better-sqlite3/build/Release/better_sqlite3.node')

test('honors an explicit nativeBinding path', () => {
  const db = openDb(':memory:', realBinding)
  expect(db.prepare('select sqlite_version() as v').get()).toHaveProperty('v')
  db.close()
})

test('a bogus nativeBinding path is actually used (throws), not ignored', () => {
  // Pre-fix, openDb ignored a second argument, so this would NOT throw.
  expect(() => openDb(':memory:', '/nonexistent/better_sqlite3.node')).toThrow()
})

test('creates registrations table with correct columns', () => {
  const db = openDb(':memory:')
  const columns = db.prepare(
    'PRAGMA table_info(registrations)'
  ).all() as Array<{ name: string }>

  const columnNames = columns.map(col => col.name)
  const expectedColumns = [
    'id', 'first_name', 'last_name', 'gender', 'age',
    'height_cm', 'weight_kg',
    'street', 'postal_code', 'city',
    'email', 'phone', 'contract_pdf_filename',
    'accepted_terms', 'tandem_master_id', 'load_number',
    'price', 'payment_method', 'voucher_payment_method',
    'voucher_number', 'voucher_service',
    'extra_booking', 'weight_surcharge', 'price_override',
    'camera_flyer_id', 'created_at', 'jump_date', 'paid_at',
    'notes', 'privacy_ack_at'
  ]

  expect(columnNames).toEqual(expectedColumns)
})

test('creates tandem_masters table', () => {
  const db = openDb(':memory:')
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='tandem_masters'"
  ).get()
  expect(row).toBeTruthy()
})

test('creates camera_flyers table', () => {
  const db = openDb(':memory:')
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='camera_flyers'"
  ).get()
  expect(row).toBeTruthy()
})

test('creates settings table', () => {
  const db = openDb(':memory:')
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
  ).get()
  expect(row).toBeTruthy()
})

// ---------------------------------------------------------------------------
// Migration of a pre-existing database.
//
// openDb's CREATE TABLE is guarded by IF NOT EXISTS, so it is a no-op against a
// database that already has the table: without the ALTER TABLE pass, a tandem.db
// created before these columns existed would never gain them. These tests use a
// real file (not :memory:) because that is the only way to hand openDb a
// database that already exists.
// ---------------------------------------------------------------------------

const tmpDirs: string[] = []

async function legacyDbPath(seedRow = true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-db-test-'))
  tmpDirs.push(dir)
  const file = path.join(dir, 'tandem.db')
  // The exact schema shipped before gender/height/split-address/voucher existed.
  const legacy = new Database(file)
  legacy.exec(`
    CREATE TABLE registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT, last_name TEXT, age INTEGER, weight_kg INTEGER,
      address TEXT, email TEXT, phone TEXT, signature_png TEXT,
      accepted_terms INTEGER,
      tandem_master_id INTEGER, load_number INTEGER, price REAL,
      payment_method TEXT, extra_booking TEXT, camera_flyer_id INTEGER,
      created_at TEXT, jump_date TEXT
    );
  `)
  if (seedRow) {
    legacy.prepare(`INSERT INTO registrations
      (first_name,last_name,age,weight_kg,address,email,phone,jump_date)
      VALUES ('Alt','Bestand',44,88,'Altgasse 9','alt@b.de','0660','2026-07-09')`).run()
  }
  legacy.close()
  return file
}

afterEach(async () => {
  while (tmpDirs.length) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true })
  }
})

test('migrates a legacy database: adds new columns, drops address, drops signature_png', async () => {
  const file = await legacyDbPath()

  const db = openDb(file)
  const names = (db.pragma('table_info(registrations)') as Array<{ name: string }>)
    .map(c => c.name)

  for (const added of ['gender', 'height_cm', 'street', 'postal_code', 'city', 'voucher_number',
    'contract_pdf_filename', 'voucher_service', 'weight_surcharge', 'price_override',
    'voucher_payment_method', 'paid_at', 'notes', 'privacy_ack_at']) {
    expect(names).toContain(added)
  }
  expect(names).not.toContain('address')
  expect(names).not.toContain('signature_png')
  db.close()
})

test('migration defaults an existing row to no surcharge and no price override', async () => {
  const file = await legacyDbPath()

  const db = openDb(file)
  const row = db.prepare('SELECT weight_surcharge, price_override, voucher_service FROM registrations').get() as any
  // ALTER TABLE ... DEFAULT backfills existing rows, so a legacy row is priced
  // exactly like a new one instead of tripping over a NULL enum.
  expect(row.weight_surcharge).toBe('none')
  expect(row.price_override).toBe(0)
  expect(row.voucher_service).toBeNull()
  db.close()
})

test('a migrated row starts out as not yet collected', async () => {
  const file = await legacyDbPath()

  const db = openDb(file)
  // NULL is the open state. A backfilled timestamp would move every old row
  // straight into the "kassiert" table without anyone having taken the money.
  expect((db.prepare('SELECT paid_at FROM registrations').get() as any).paid_at).toBeNull()
  db.close()
})

test('migration preserves existing rows', async () => {
  const file = await legacyDbPath()

  const db = openDb(file)
  const row = db.prepare('SELECT first_name,last_name,age,street FROM registrations').get() as any
  expect(row.first_name).toBe('Alt')
  expect(row.age).toBe(44)
  // A row written before the split has no street; it must survive as NULL, not vanish.
  expect(row.street).toBeNull()
  db.close()
})

test('migration is idempotent across repeated startups', async () => {
  const file = await legacyDbPath()

  openDb(file).close()
  openDb(file).close()
  const db = openDb(file)

  const names = (db.pragma('table_info(registrations)') as Array<{ name: string }>)
    .map(c => c.name)
  // Each column exactly once — a non-guarded ALTER would have thrown by now.
  expect(new Set(names).size).toBe(names.length)
  expect((db.prepare('SELECT COUNT(*) c FROM registrations').get() as any).c).toBe(1)
  db.close()
})

test('a migrated database has the same column set as a fresh one', async () => {
  const file = await legacyDbPath(false)

  const migrated = openDb(file)
  const fresh = openDb(':memory:')
  const cols = (d: ReturnType<typeof openDb>) =>
    new Set((d.pragma('table_info(registrations)') as Array<{ name: string }>).map(c => c.name))

  // Order differs (ALTER TABLE appends), so compare as sets.
  expect(cols(migrated)).toEqual(cols(fresh))
  migrated.close()
  fresh.close()
})
