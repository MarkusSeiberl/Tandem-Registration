import { test, expect } from 'vitest'
import { openDb } from '../src/server/db'
import { buildServer } from '../src/server/index'
import os from 'os'

test('add and list tandem masters', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })
  const list = await app.inject({ method: 'GET', url: '/api/masters' })
  expect(list.json()[0].name).toBe('Hans')
  await app.close()
})

test('unknown kind returns 404', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const res = await app.inject({ method: 'GET', url: '/api/bogus' })
  expect(res.statusCode).toBe(404)
  await app.close()
})

test('empty name returns 400', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const res = await app.inject({ method: 'POST', url: '/api/masters', payload: { name: '' } })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('delete soft-deletes and excludes from list', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const created = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })
  const { id } = created.json()
  const del = await app.inject({ method: 'DELETE', url: `/api/flyers/${id}` })
  expect(del.statusCode).toBe(204)
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()).toEqual([])
  await app.close()
})
