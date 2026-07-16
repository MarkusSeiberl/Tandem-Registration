import { test, expect } from 'vitest'
import { openDb } from '../src/server/db'
import { buildServer } from '../src/server/index'
import os from 'os'

const validBody = () => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '1',
  signature_png: 'data:image/png;base64,x', accepted_terms: true
})

test('patch adds manifest fields', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: 3, payment_method: 'cash', extra_booking: 'video' }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().load_number).toBe(3)
  expect(res.json().payment_method).toBe('cash')
  expect(res.json().extra_booking).toBe('video')
  await app.close()
})

test('patch stores a voucher number alongside the voucher payment', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_number: 'GS-2026-0042' }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().payment_method).toBe('voucher')
  // voucher_number has to be on the PATCH allowlist, or this save is silently dropped.
  expect(res.json().voucher_number).toBe('GS-2026-0042')
  await app.close()
})

test('patch clears the voucher number when payment moves away from voucher', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_number: 'GS-2026-0042' }
  })
  // The manifest sends null itself (mirroring how it clears a stale camera_flyer_id).
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'cash', voucher_number: null }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().payment_method).toBe('cash')
  expect(res.json().voucher_number).toBeNull()
  await app.close()
})

test('patch updates only the provided keys', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: 1, price: 100 }
  })
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: 2 }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().load_number).toBe(2)
  expect(res.json().price).toBe(100)
  await app.close()
})

test('rejects invalid payment_method with 400', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'bitcoin' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects invalid extra_booking with 400', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { extra_booking: 'drone' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('returns 404 for unknown id', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const res = await app.inject({
    method: 'PATCH', url: '/api/registrations/999999',
    payload: { load_number: 1 }
  })
  expect(res.statusCode).toBe(404)
  await app.close()
})

test('rejects empty-string payment_method with 400', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: '' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects null payment_method with 400', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: null }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects empty-string extra_booking with 400', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { extra_booking: '' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('does not broadcast "changed" when patching an unknown id', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  const base = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr!.port}`

  const res = await fetch(`${base}/api/events`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()

  try {
    const patch = await app.inject({
      method: 'PATCH', url: '/api/registrations/999999',
      payload: { load_number: 1 }
    })
    expect(patch.statusCode).toBe(404)

    const deadline = Date.now() + 500
    let buf = ''
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const result = await Promise.race([
        reader.read(),
        new Promise<{ value: undefined; done: false }>((resolve) =>
          setTimeout(() => resolve({ value: undefined, done: false }), remaining))
      ])
      if (result.value) buf += decoder.decode(result.value)
      if ((result as any).done) break
    }
    expect(buf).not.toContain('event: changed')
  } finally {
    await reader.cancel().catch(() => {})
    await app.close()
  }
})

test('ignores keys not in the allowlist (including id spoofing)', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: 5, bogus_col: 'x', id: 999 }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().load_number).toBe(5)
  expect(res.json().id).toBe(id)
  await app.close()
})

test('broadcasts a "changed" SSE event on patch', async () => {
  const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  const base = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr!.port}`

  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()

  const res = await fetch(`${base}/api/events`)
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()

  try {
    const patch = await app.inject({
      method: 'PATCH', url: `/api/registrations/${id}`,
      payload: { load_number: 5 }
    })
    expect(patch.statusCode).toBe(200)

    const deadline = Date.now() + 3000
    let buf = ''
    while (Date.now() < deadline && !buf.includes('event: changed')) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value)
    }
    expect(buf).toContain('event: changed')
    expect(buf).toContain(`"id":"${id}"`)
  } finally {
    await reader.cancel().catch(() => {})
    await app.close()
  }
})
