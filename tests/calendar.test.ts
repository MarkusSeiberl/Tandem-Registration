import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

function seed(db: ReturnType<typeof testServer>['db'], dates: string[]) {
  const insert = db.prepare('INSERT INTO registrations (first_name, jump_date) VALUES (?, ?)')
  for (const date of dates) insert.run('Gast', date)
}

test('counts the registrations of each day in the month', async () => {
  const { app, db } = testServer()
  seed(db, ['2026-10-03', '2026-10-03', '2026-10-17', '2026-10-31'])
  const res = await app.inject({ method: 'GET', url: '/api/calendar/2026-10' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({
    days: [
      { date: '2026-10-03', count: 2 },
      { date: '2026-10-17', count: 1 },
      { date: '2026-10-31', count: 1 },
    ],
  })
  await app.close()
})

test('leaves out the days of neighbouring months', async () => {
  const { app, db } = testServer()
  seed(db, ['2026-09-30', '2026-10-01', '2026-11-01'])
  const res = await app.inject({ method: 'GET', url: '/api/calendar/2026-10' })
  expect(res.json()).toEqual({ days: [{ date: '2026-10-01', count: 1 }] })
  await app.close()
})

test('a month without registrations answers with no days', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/calendar/2026-10' })
  expect(res.json()).toEqual({ days: [] })
  await app.close()
})

test('rejects a malformed month', async () => {
  const { app } = testServer()
  for (const month of ['2026-13', '2026-1', 'oktober']) {
    const res = await app.inject({ method: 'GET', url: `/api/calendar/${month}` })
    expect(res.statusCode).toBe(400)
  }
  await app.close()
})
