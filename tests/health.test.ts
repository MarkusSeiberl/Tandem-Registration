import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

test('health returns ok', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.json()).toEqual({ ok: true })
  await app.close()
})
