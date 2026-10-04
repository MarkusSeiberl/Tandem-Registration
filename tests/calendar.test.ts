import { test, expect } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
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
      { date: '2026-10-03', count: 2, exported: false },
      { date: '2026-10-17', count: 1, exported: false },
      { date: '2026-10-31', count: 1, exported: false },
    ],
  })
  await app.close()
})

test('leaves out the days of neighbouring months', async () => {
  const { app, db } = testServer()
  seed(db, ['2026-09-30', '2026-10-01', '2026-11-01'])
  const res = await app.inject({ method: 'GET', url: '/api/calendar/2026-10' })
  expect(res.json()).toEqual({ days: [{ date: '2026-10-01', count: 1, exported: false }] })
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

test('says which days had their Tagesabschluss', async () => {
  const { app, db } = testServer()
  seed(db, ['2026-10-03', '2026-10-04'])
  const res = await app.inject({ method: 'POST', url: '/api/export?date=2026-10-03' })
  expect(res.statusCode).toBe(200)

  const days = (await app.inject({ method: 'GET', url: '/api/calendar/2026-10' })).json().days
  expect(days).toEqual([
    { date: '2026-10-03', count: 1, exported: true },
    { date: '2026-10-04', count: 1, exported: false },
  ])
  await app.close()
})

test('a Tagesabschluss that failed does not count as done', async () => {
  // The export folder sits under a file, so creating it fails.
  const blocker = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-cal-')), 'file')
  await fs.writeFile(blocker, '')
  const { app, db } = testServer({ exportDir: path.join(blocker, 'export') })
  seed(db, ['2026-10-03'])
  const res = await app.inject({ method: 'POST', url: '/api/export?date=2026-10-03' })
  expect(res.statusCode).toBe(500)

  const days = (await app.inject({ method: 'GET', url: '/api/calendar/2026-10' })).json().days
  expect(days).toEqual([{ date: '2026-10-03', count: 1, exported: false }])
  await app.close()
  await fs.rm(path.dirname(blocker), { recursive: true, force: true })
})
