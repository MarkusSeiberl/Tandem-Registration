import { test, expect } from 'vitest'
import { openDb } from '../src/server/db'
import { buildServer } from '../src/server/index'
import os from 'os'

test('health returns ok', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.json()).toEqual({ ok: true })
  await app.close()
})
