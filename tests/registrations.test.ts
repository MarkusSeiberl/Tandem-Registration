import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

const validBody = () => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', accepted_terms: true
})

async function waitForSseChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
  timeoutMs = 3000
): Promise<string> {
  const decoder = new TextDecoder()
  const deadline = Date.now() + timeoutMs
  let buf = ''
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now()
    const result = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('sse read timeout')), remaining))
    ])
    if (result.done) throw new Error('SSE stream closed before event arrived')
    buf += decoder.decode(result.value)
    if (buf.includes(needle)) return buf
  }
  throw new Error(`timed out waiting for "${needle}"; got so far: ${buf}`)
}

test('create then list returns the record', async () => {
  const { app } = testServer()
  const body = validBody()
  const create = await app.inject({ method:'POST', url:'/api/registrations', payload: body })
  expect(create.statusCode).toBe(201)
  const list = await app.inject({ method:'GET', url:'/api/registrations' })
  const rows = list.json()
  expect(rows.length).toBe(1)
  const row = rows[0]
  const todayStr = new Date().toISOString().slice(0, 10)
  expect(row.jump_date).toBe(todayStr)
  expect(isNaN(Date.parse(row.created_at))).toBe(false)
  expect(row.first_name).toBe(body.first_name)
  expect(row.email).toBe(body.email)
  // Every guest field must survive the round-trip into the database, not just
  // pass validation on the way in.
  expect(row.gender).toBe('female')
  expect(row.height_cm).toBe(170)
  expect(row.street).toBe('X 1')
  expect(row.postal_code).toBe('4240')
  expect(row.city).toBe('Freistadt')
  await app.close()
})

test('rejects a registration with an unknown gender', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'POST', url: '/api/registrations',
    payload: { ...validBody(), gender: 'weiblich' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects invalid', async () => {
  const { app } = testServer()
  const res = await app.inject({ method:'POST', url:'/api/registrations', payload:{} })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('filters registrations by jump_date', async () => {
  const { app } = testServer()
  const create = await app.inject({ method:'POST', url:'/api/registrations', payload: validBody() })
  expect(create.statusCode).toBe(201)

  const emptyList = await app.inject({ method:'GET', url:'/api/registrations?date=2000-01-01' })
  expect(emptyList.json()).toEqual([])

  const todayStr = new Date().toISOString().slice(0, 10)
  const todayList = await app.inject({ method:'GET', url:`/api/registrations?date=${todayStr}` })
  expect(todayList.json().length).toBe(1)

  await app.close()
})

test('broadcasts a "changed" SSE event when a registration is created', async () => {
  const { app } = testServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  const base = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr!.port}`

  const res = await fetch(`${base}/api/events`)
  const reader = res.body!.getReader()

  try {
    const create = await app.inject({ method:'POST', url:'/api/registrations', payload: validBody() })
    expect(create.statusCode).toBe(201)
    const createdId = create.json().id

    const chunk = await waitForSseChunk(reader, 'event: changed')
    expect(chunk).toContain('event: changed')
    expect(chunk).toContain(`"id":${createdId}`)
  } finally {
    await reader.cancel().catch(() => {})
    await app.close()
  }
})
