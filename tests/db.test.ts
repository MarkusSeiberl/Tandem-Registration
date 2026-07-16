import { test, expect } from 'vitest'
import { createRequire } from 'node:module'
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
    'id', 'first_name', 'last_name', 'age', 'weight_kg',
    'address', 'email', 'phone', 'signature_png',
    'accepted_terms', 'tandem_master_id', 'load_number',
    'price', 'payment_method', 'extra_booking',
    'camera_flyer_id', 'created_at', 'jump_date'
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
