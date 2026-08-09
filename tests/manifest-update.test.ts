import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

const validBody = () => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '1',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', accepted_terms: true, privacy_ack: true
})

test('patch adds manifest fields', async () => {
  const { app } = testServer()
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
  const { app } = testServer()
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
  const { app } = testServer()
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
  const { app } = testServer()
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

test('patch recomputes the price from the price table', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'cash', extra_booking: 'video', weight_surcharge: 'over_90' }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().price).toBe(410)
  await app.close()
})

test('a voucher is deducted from the service the guest flies', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: {
      payment_method: 'voucher', voucher_number: 'GS-1', voucher_service: 'jump',
      extra_booking: 'video', weight_surcharge: 'none'
    }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().voucher_service).toBe('jump')
  expect(res.json().price).toBe(100)
  await app.close()
})

test('upgrading a voucher costs only the difference', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: {
      payment_method: 'voucher', voucher_service: 'jump_video', extra_booking: 'video_photo'
    }
  })
  expect(res.json().price).toBe(20)
  await app.close()
})

test('changing only the voucher service reprices the row', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'video_photo' }
  })
  // 390 - 270 = 120 before; the corrected voucher covers video too.
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { voucher_service: 'jump_video' }
  })
  expect(res.json().price).toBe(20)
  await app.close()
})

test('the recomputation uses the fields already stored, not only the ones sent', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'cash', extra_booking: 'video' }
  })
  // Only the surcharge changes — the stored 'video' must still be priced in.
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { weight_surcharge: 'over_100' }
  })
  expect(res.json().price).toBe(270 + 100 + 60)
  await app.close()
})

test('a price sent by the manifest is kept and marks the row as overridden', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'cash', extra_booking: 'video', price: 300 }
  })
  expect(res.json().price).toBe(300)
  expect(res.json().price_override).toBe(1)

  // A later change to a priced field must not overwrite the manual correction.
  const after = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { weight_surcharge: 'over_90' }
  })
  expect(after.json().price).toBe(300)
  await app.close()
})

test('clearing the override hands the price back to the price table', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'cash', extra_booking: 'video', price: 300 }
  })
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { price_override: 0, extra_booking: 'video_photo' }
  })
  expect(res.json().price_override).toBe(0)
  expect(res.json().price).toBe(390)
  await app.close()
})

test('the price follows the amounts configured in the settings', async () => {
  const { app, cfgRef } = testServer()
  cfgRef.current.prices = { ...cfgRef.current.prices, jump: 300, weight_over_100: 80 }
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'card', weight_surcharge: 'over_100' }
  })
  expect(res.json().price).toBe(380)
  await app.close()
})

test('patch stores how a voucher top-up was paid', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: {
      payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'video',
      voucher_payment_method: 'cash'
    }
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().voucher_payment_method).toBe('cash')
  expect(res.json().price).toBe(100)
  await app.close()
})

test('rejects an invalid or voucher-valued top-up method with 400, but accepts null', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  for (const bad of ['paypal', 'voucher', '']) {
    const res = await app.inject({
      method: 'PATCH', url: `/api/registrations/${id}`,
      payload: { voucher_payment_method: bad }
    })
    expect(res.statusCode).toBe(400)
  }
  const cleared = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { voucher_payment_method: null }
  })
  expect(cleared.statusCode).toBe(200)
  expect(cleared.json().voucher_payment_method).toBeNull()
  await app.close()
})

test('a fresh registration starts out as not yet collected', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({ method: 'GET', url: '/api/registrations' })
  expect(res.json().find((r: any) => r.id === id).paid_at).toBeNull()
  await app.close()
})

test('patch paid:true stamps the collection time on the server', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const before = Date.now()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: true },
  })
  expect(res.statusCode).toBe(200)
  const paidAt = res.json().paid_at
  // The client sends a flag, never a timestamp — several tablets with drifting
  // clocks would otherwise decide the order of the day.
  expect(Date.parse(paidAt)).toBeGreaterThanOrEqual(before - 1000)
  expect(Date.parse(paidAt)).toBeLessThanOrEqual(Date.now() + 1000)
  await app.close()
})

test('patch paid:false puts the row back into the open table', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({ method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: true } })
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: false },
  })
  expect(res.json().paid_at).toBeNull()
  await app.close()
})

test('marking an already collected row again keeps the original timestamp', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const first = (await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: true },
  })).json().paid_at
  const again = (await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: true },
  })).json().paid_at
  expect(again).toBe(first)
  await app.close()
})

test('collecting a row leaves its price alone', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { extra_booking: 'video', weight_surcharge: 'over_90' },
  })
  const res = await app.inject({ method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: true } })
  expect(res.json().price).toBe(410)
  await app.close()
})

test('a client cannot write paid_at directly', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid_at: '1999-01-01T00:00:00.000Z' },
  })
  expect(res.json().paid_at).toBeNull()
  await app.close()
})

test('rejects a non-boolean paid with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: 'ja' },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('Kassiert-Status ungültig')
  await app.close()
})

test('rejects invalid weight_surcharge with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { weight_surcharge: 'over_150' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects invalid voucher_service with 400 but accepts null', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const bad = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { voucher_service: 'jump_champagne' }
  })
  expect(bad.statusCode).toBe(400)

  const cleared = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { voucher_service: null }
  })
  expect(cleared.statusCode).toBe(200)
  expect(cleared.json().voucher_service).toBeNull()
  await app.close()
})

test('rejects invalid payment_method with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'bitcoin' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects invalid extra_booking with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { extra_booking: 'drone' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('returns 404 for unknown id', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'PATCH', url: '/api/registrations/999999',
    payload: { load_number: 1 }
  })
  expect(res.statusCode).toBe(404)
  await app.close()
})

test('rejects empty-string payment_method with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: '' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects null payment_method with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: null }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('rejects empty-string extra_booking with 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { extra_booking: '' }
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('does not broadcast "changed" when patching an unknown id', async () => {
  const { app } = testServer()
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
  const { app } = testServer()
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
  const { app } = testServer()
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

test('patch stores a note and trims it', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { notes: '  Zahlt den Rest am Sonntag  ' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().notes).toBe('Zahlt den Rest am Sonntag')
  await app.close()
})

test('an emptied note becomes NULL rather than an empty string', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  await app.inject({ method: 'PATCH', url: `/api/registrations/${id}`, payload: { notes: 'Alt' } })
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { notes: '   ' },
  })
  // Both forms print as a blank cell, but only NULL says "there is no note".
  expect(res.json().notes).toBeNull()
  await app.close()
})

test('rejects a note that is not text', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { notes: 42 },
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})
