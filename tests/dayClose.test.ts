import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

const URL_0709 = '/api/day-close/2026-07-09'

test('a day nobody counted answers with an empty Kassensturz', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: URL_0709 })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ countedCash: null, countedCard: null, note: '', exportedAt: null })
  await app.close()
})

test('the counted amounts put on a day come back on that day, note trimmed', async () => {
  const { app } = testServer()
  const put = await app.inject({
    method: 'PUT', url: URL_0709,
    payload: { countedCash: 1300, countedCard: 548.5, note: '  Trinkgeld  ' },
  })
  expect(put.statusCode).toBe(200)
  expect(put.json()).toEqual({ countedCash: 1300, countedCard: 548.5, note: 'Trinkgeld', exportedAt: null })

  const res = await app.inject({ method: 'GET', url: URL_0709 })
  expect(res.json()).toEqual({ countedCash: 1300, countedCard: 548.5, note: 'Trinkgeld', exportedAt: null })
  await app.close()
})

test('a till left empty is stored as not counted', async () => {
  const { app } = testServer()
  await app.inject({ method: 'PUT', url: URL_0709, payload: { countedCash: 100, countedCard: 50, note: '' } })
  await app.inject({ method: 'PUT', url: URL_0709, payload: { countedCash: null, countedCard: 50, note: '' } })
  const res = await app.inject({ method: 'GET', url: URL_0709 })
  expect(res.json().countedCash).toBeNull()
  expect(res.json().countedCard).toBe(50)
  await app.close()
})

test('each day keeps its own Kassensturz', async () => {
  const { app } = testServer()
  await app.inject({ method: 'PUT', url: URL_0709, payload: { countedCash: 1, countedCard: null, note: 'a' } })
  await app.inject({
    method: 'PUT', url: '/api/day-close/2026-07-10', payload: { countedCash: 2, countedCard: null, note: 'b' },
  })
  expect((await app.inject({ method: 'GET', url: URL_0709 })).json().note).toBe('a')
  expect((await app.inject({ method: 'GET', url: '/api/day-close/2026-07-10' })).json().note).toBe('b')
  await app.close()
})

test('exportedAt is when that day\'s Tagesabschluss last went through', async () => {
  const { app, db } = testServer()
  db.prepare('INSERT INTO day_exports (jump_date, exported_at) VALUES (?, ?)')
    .run('2026-07-09', '2026-07-09T16:42:00.000Z')
  const res = await app.inject({ method: 'GET', url: URL_0709 })
  expect(res.json().exportedAt).toBe('2026-07-09T16:42:00.000Z')
  await app.close()
})

test.each([
  ['an invalid date', '/api/day-close/2026-7-9', { countedCash: 1, countedCard: 1, note: '' }],
  ['a negative amount', URL_0709, { countedCash: -1, countedCard: null, note: '' }],
  ['more than two decimals', URL_0709, { countedCash: 1.005, countedCard: null, note: '' }],
  ['a string amount', URL_0709, { countedCash: 'x', countedCard: null, note: '' }],
  ['a note over 500 characters', URL_0709, { countedCash: null, countedCard: null, note: 'x'.repeat(501) }],
  ['a missing note', URL_0709, { countedCash: null, countedCard: null }],
])('PUT rejects %s', async (_name, url, payload) => {
  const { app } = testServer()
  const res = await app.inject({ method: 'PUT', url, payload })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('PUT rejects a non-finite amount', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'PUT', url: URL_0709,
    headers: { 'content-type': 'application/json' },
    payload: '{"countedCash":1e309,"countedCard":null,"note":""}',
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('GET rejects an invalid date', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/day-close/nope' })
  expect(res.statusCode).toBe(400)
  await app.close()
})
