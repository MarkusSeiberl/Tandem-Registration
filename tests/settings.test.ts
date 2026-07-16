import { test, expect } from 'vitest'
import { openDb } from '../src/server/db'
import { buildServer } from '../src/server/index'

test('get/put settings', async () => {
  const cfgRef = { current: { exportDir: '/tmp/x', contractText: '' } }
  const app = buildServer(openDb(':memory:'), cfgRef)
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '/tmp/y', contractText: 'Hallo' } })
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().contractText).toBe('Hallo')
  expect(cfgRef.current.exportDir).toBe('/tmp/y')
  await app.close()
})

test('put settings rejects empty exportDir', async () => {
  const cfgRef = { current: { exportDir: '/tmp/x', contractText: '' } }
  const app = buildServer(openDb(':memory:'), cfgRef)
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '' } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('exportDir ungültig')
  expect(cfgRef.current.exportDir).toBe('/tmp/x')
  await app.close()
})

test('put settings accepts valid exportDir', async () => {
  const cfgRef = { current: { exportDir: '/tmp/x', contractText: '' } }
  const app = buildServer(openDb(':memory:'), cfgRef)
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '/tmp/z' } })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.exportDir).toBe('/tmp/z')
  await app.close()
})
