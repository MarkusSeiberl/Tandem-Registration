import { afterAll, beforeAll, expect, test } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { testServer } from './helpers/testServer'

// A real directory and a real file, so the check runs against the filesystem it
// will meet in production rather than against a stubbed `fs`.
let dir: string
let file: string

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-paths-'))
  file = path.join(dir, 'Tandemliste.xlsx')
  fs.writeFileSync(file, 'x')
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

async function check(payload: Record<string, string>) {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/paths/check', payload })
  const body = res.json()
  await app.close()
  return { statusCode: res.statusCode, body }
}

test('reports existing paths as ok', async () => {
  const { statusCode, body } = await check({
    exportDir: dir, backupDir: dir, voucherListPath: file,
  })
  expect(statusCode).toBe(200)
  expect(body).toEqual({ exportDir: 'ok', backupDir: 'ok', voucherListPath: 'ok' })
})

test('reports a path that is not there', async () => {
  const { body } = await check({
    exportDir: path.join(dir, 'weg'),
    voucherListPath: path.join(dir, 'Fehlt.xlsx'),
  })
  expect(body).toEqual({ exportDir: 'missing', voucherListPath: 'missing' })
})

test('reports a file where a directory belongs', async () => {
  const { body } = await check({ exportDir: file })
  expect(body).toEqual({ exportDir: 'wrong-type' })
})

test('reports a directory where a file belongs', async () => {
  const { body } = await check({ voucherListPath: dir })
  expect(body).toEqual({ voucherListPath: 'wrong-type' })
})

test('accepts the empty values that switch a setting off', async () => {
  // Empty backupDir means "use the export directory", empty voucherListPath
  // means "no voucher check at all" — neither is a broken path.
  const { body } = await check({ backupDir: '', voucherListPath: '' })
  expect(body).toEqual({ backupDir: 'ok', voucherListPath: 'ok' })
})

test('answers only about the keys it was asked about', async () => {
  const { body } = await check({ backupDir: dir })
  expect(body).toEqual({ backupDir: 'ok' })
})

test('ignores keys that are not paths', async () => {
  const { body } = await check({ jumpLocation: 'Freistadt', contractText: 'Hallo' })
  expect(body).toEqual({})
})

test('reports a non-string value as invalid rather than crashing', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'POST', url: '/api/paths/check', payload: { exportDir: 123 },
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})
