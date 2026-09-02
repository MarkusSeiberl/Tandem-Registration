import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'
import { dayIsFrozen } from '../src/server/dayTables'

test('a day nobody named a Betriebsleiter for answers with an empty name', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-09' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ name: '' })
  await app.close()
})

test('the name put on a day comes back on that day', async () => {
  const { app } = testServer()
  const put = await app.inject({
    method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: '  Max Muster  ' },
  })
  expect(put.statusCode).toBe(200)
  expect(put.json()).toEqual({ name: 'Max Muster' })

  const res = await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-09' })
  expect(res.json()).toEqual({ name: 'Max Muster' })
  await app.close()
})

test('each day keeps its own Betriebsleiter', async () => {
  const { app } = testServer()
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: 'Max Muster' } })
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-10', payload: { name: 'Maria Berger' } })

  expect((await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-09' })).json())
    .toEqual({ name: 'Max Muster' })
  expect((await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-10' })).json())
    .toEqual({ name: 'Maria Berger' })
  await app.close()
})

test('a name put on a day that already has one replaces it', async () => {
  const { app } = testServer()
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: 'Max Muster' } })
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: 'Maria Berger' } })

  expect((await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-09' })).json())
    .toEqual({ name: 'Maria Berger' })
  await app.close()
})

test('an emptied field clears the day again', async () => {
  const { app } = testServer()
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: 'Max Muster' } })
  const put = await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: '   ' } })
  expect(put.json()).toEqual({ name: '' })

  expect((await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-09' })).json())
    .toEqual({ name: '' })
  await app.close()
})

// The name is not a price. Typing it must not mark the day as flown, or clicking
// into a day in the future would freeze it at today's price list.
test('naming a Betriebsleiter does not freeze the day', async () => {
  const { app, db } = testServer()
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: 'Max Muster' } })
  expect(dayIsFrozen(db, '2026-07-09')).toBe(false)
  await app.close()
})

test('a malformed date is rejected', async () => {
  const { app } = testServer()
  const get = await app.inject({ method: 'GET', url: '/api/day-manager/09.07.2026' })
  expect(get.statusCode).toBe(400)
  const put = await app.inject({
    method: 'PUT', url: '/api/day-manager/09.07.2026', payload: { name: 'Max Muster' },
  })
  expect(put.statusCode).toBe(400)
  await app.close()
})

test('a missing name is rejected rather than silently clearing the day', async () => {
  const { app } = testServer()
  await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: { name: 'Max Muster' } })
  const res = await app.inject({ method: 'PUT', url: '/api/day-manager/2026-07-09', payload: {} })
  expect(res.statusCode).toBe(400)

  expect((await app.inject({ method: 'GET', url: '/api/day-manager/2026-07-09' })).json())
    .toEqual({ name: 'Max Muster' })
  await app.close()
})
