import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

test('add and list tandem masters', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })
  const list = await app.inject({ method: 'GET', url: '/api/masters' })
  expect(list.json()[0].name).toBe('Hans')
  await app.close()
})

test('unknown kind returns 404', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/bogus' })
  expect(res.statusCode).toBe(404)
  await app.close()
})

test('empty name returns 400', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/masters', payload: { name: '' } })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('delete soft-deletes and excludes from list', async () => {
  const { app } = testServer()
  const created = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })
  const { id } = created.json()
  const del = await app.inject({ method: 'DELETE', url: `/api/flyers/${id}` })
  expect(del.statusCode).toBe(204)
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()).toEqual([])
  await app.close()
})

test('flyer can be added with an email', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter', email: ' peter@example.at ' } })
  expect(res.statusCode).toBe(201)
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()).toEqual([{ id: res.json().id, name: 'Peter', email: 'peter@example.at' }])
  await app.close()
})

test('flyer without email is stored with null', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Anna', email: '  ' } })
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()[0].email).toBeNull()
  await app.close()
})

test('invalid email returns 400', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter', email: 'peter.example.at' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'E-Mail ungültig' })
  await app.close()
})

test('email on a tandem master returns 400', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans', email: 'hans@example.at' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'E-Mail nur für Kameraflieger' })
  await app.close()
})

test('masters list carries no email key', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })
  const list = await app.inject({ method: 'GET', url: '/api/masters' })
  expect(Object.keys(list.json()[0])).toEqual(['id', 'name'])
  await app.close()
})

test('PATCH changes a flyer name and email', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: 'Peter Huber', email: 'peter@example.at' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id, name: 'Peter Huber', email: 'peter@example.at' })
  await app.close()
})

test('PATCH with an empty email clears it', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter', email: 'peter@example.at' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: 'Peter', email: '' } })
  expect(res.json().email).toBeNull()
  await app.close()
})

test('PATCH renames a tandem master', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/masters/${id}`, payload: { name: 'Hans Maier' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id, name: 'Hans Maier' })
  await app.close()
})

test('PATCH with an empty name returns 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: ' ' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'Name fehlt' })
  await app.close()
})

test('PATCH of an unknown or removed entry returns 404', async () => {
  const { app } = testServer()
  const unknown = await app.inject({ method: 'PATCH', url: '/api/flyers/999', payload: { name: 'X' } })
  expect(unknown.statusCode).toBe(404)
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })).json()
  await app.inject({ method: 'DELETE', url: `/api/flyers/${id}` })
  const removed = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: 'Peter' } })
  expect(removed.statusCode).toBe(404)
  await app.close()
})

test('PATCH of an unknown kind returns 404', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'PATCH', url: '/api/bogus/1', payload: { name: 'X' } })
  expect(res.statusCode).toBe(404)
  await app.close()
})
