import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

// The dialog opens on the desktop of the machine running the server, so only a
// caller sitting at that machine may ask for it. Everything here is checked
// against a fake picker — no test may spawn a real dialog.

test('offers the picker to a local caller when one is wired up', async () => {
  const { app } = testServer({}, undefined, async () => 'C:/Tandem')
  const res = await app.inject({ method: 'GET', url: '/api/pick-path' })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ available: true })
  await app.close()
})

test('offers no picker when none is wired up', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/pick-path' })
  expect(res.json()).toEqual({ available: false })
  await app.close()
})

test('offers no picker to a caller from another machine', async () => {
  const { app } = testServer({}, undefined, async () => 'C:/Tandem')
  const res = await app.inject({
    method: 'GET', url: '/api/pick-path', remoteAddress: '192.168.0.42',
  })
  expect(res.json()).toEqual({ available: false })
  await app.close()
})

test('returns the picked path', async () => {
  const { app } = testServer({}, undefined, async () => 'C:/Tandem/Export')
  const res = await app.inject({
    method: 'POST', url: '/api/pick-path', payload: { kind: 'directory', current: '' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ path: 'C:/Tandem/Export' })
  await app.close()
})

test('hands the picker the kind and the current value to start from', async () => {
  const seen: Array<[string, string]> = []
  const { app } = testServer({}, undefined, async (kind, current) => {
    seen.push([kind, current])
    return null
  })
  await app.inject({
    method: 'POST', url: '/api/pick-path',
    payload: { kind: 'excel-file', current: 'C:/Verein/Tandemliste.xlsx' },
  })
  expect(seen).toEqual([['excel-file', 'C:/Verein/Tandemliste.xlsx']])
  await app.close()
})

test('reports a cancelled dialog as no path, not as an error', async () => {
  const { app } = testServer({}, undefined, async () => null)
  const res = await app.inject({
    method: 'POST', url: '/api/pick-path', payload: { kind: 'directory', current: '' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ path: null })
  await app.close()
})

test('refuses to open a dialog for a caller from another machine', async () => {
  let opened = false
  const { app } = testServer({}, undefined, async () => {
    opened = true
    return 'C:/Tandem'
  })
  const res = await app.inject({
    method: 'POST', url: '/api/pick-path',
    payload: { kind: 'directory', current: '' },
    remoteAddress: '192.168.0.42',
  })
  expect(res.statusCode).toBe(403)
  // Nobody at that other machine could see the dialog, so it must not appear at
  // all — an unanswered dialog would sit on the host desktop for good.
  expect(opened).toBe(false)
  await app.close()
})

test('reports 503 when no picker is wired up', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'POST', url: '/api/pick-path', payload: { kind: 'directory', current: '' },
  })
  expect(res.statusCode).toBe(503)
  await app.close()
})

test('rejects an unknown kind', async () => {
  let opened = false
  const { app } = testServer({}, undefined, async () => {
    opened = true
    return 'C:/Tandem'
  })
  const res = await app.inject({
    method: 'POST', url: '/api/pick-path', payload: { kind: 'registry-key', current: '' },
  })
  expect(res.statusCode).toBe(400)
  expect(opened).toBe(false)
  await app.close()
})

test('treats a missing current value as an empty one', async () => {
  const seen: string[] = []
  const { app } = testServer({}, undefined, async (_kind, current) => {
    seen.push(current)
    return null
  })
  const res = await app.inject({
    method: 'POST', url: '/api/pick-path', payload: { kind: 'directory' },
  })
  expect(res.statusCode).toBe(200)
  expect(seen).toEqual([''])
  await app.close()
})
