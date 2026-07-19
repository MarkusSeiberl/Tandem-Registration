import { test, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import Database from 'better-sqlite3'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { openDb } from '../src/server/db'
import { registerBackupRoutes } from '../src/server/routes/backup'

const tmpDirs: string[] = []

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-backup-test-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true })
  }
})

function cfgRef(backupDir: string, exportDir: string) {
  return { current: { exportDir, contractText: '', jumpLocation: '', backupDir } }
}

test('POST /api/backup writes a usable copy of the database into backupDir', async () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO tandem_masters (name,active) VALUES (?,1)').run('Hans')

  const backupDir = await makeTmpDir()
  const app = Fastify()
  registerBackupRoutes(app, db, cfgRef(backupDir, '/unused'))

  const res = await app.inject({ method: 'POST', url: '/api/backup' })
  expect(res.statusCode).toBe(200)
  const body = res.json()
  expect(path.dirname(body.path)).toBe(backupDir)
  expect(path.basename(body.path)).toMatch(/^tandem_backup_.+\.db$/)

  const stat = await fs.stat(body.path)
  expect(stat.isFile()).toBe(true)

  // The backup must be a real, queryable SQLite file carrying the seeded row.
  const restored = new Database(body.path, { readonly: true })
  const row = restored.prepare('SELECT name FROM tandem_masters').get() as { name: string }
  expect(row.name).toBe('Hans')
  restored.close()

  await app.close()
})

test('POST /api/backup falls back to exportDir when backupDir is empty', async () => {
  const db = openDb(':memory:')
  const exportDir = await makeTmpDir()
  const app = Fastify()
  registerBackupRoutes(app, db, cfgRef('', exportDir))

  const res = await app.inject({ method: 'POST', url: '/api/backup' })
  expect(res.statusCode).toBe(200)
  expect(path.dirname(res.json().path)).toBe(exportDir)

  await app.close()
})
