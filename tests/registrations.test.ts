import { test, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { testServer } from './helpers/testServer'
import { pdfText } from './helpers/pdfText'
import { today } from '../src/server/day'

async function pdfContains(filePath: string, needle: string): Promise<boolean> {
  return (await pdfText(fs.readFileSync(filePath))).includes(needle)
}

const validBody = () => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', accepted_terms: true, privacy_ack: true
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
  const todayStr = today()
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

// The drop zone is 30 km from the Czech border. Drawing the contract with a PDF
// standard font threw `WinAnsi cannot encode "ř"` before the row was inserted,
// so the whole registration 500'd: no row, no contract, and a tablet that said
// only "Server-Fehler. Bitte erneut versuchen." to a guest for whom no retry
// could ever work.
test('a guest whose name needs more than WinAnsi can register', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-umlaut-'))
  const { app } = testServer({ exportDir })

  const create = await app.inject({
    method: 'POST',
    url: '/api/registrations',
    payload: {
      ...validBody(),
      first_name: 'Ondřej',
      last_name: 'Nováček',
      street: 'Hlavní třída 12',
      city: 'Český Krumlov',
    },
  })
  expect(create.statusCode).toBe(201)

  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]
  expect(row.first_name).toBe('Ondřej')

  // And the contract really carries the name, rather than the row having been
  // saved while the PDF quietly lost it.
  const pdfPath = path.join(exportDir, 'vertaege', row.contract_pdf_filename)
  expect(await pdfContains(pdfPath, 'Ondřej')).toBe(true)
  expect(await pdfContains(pdfPath, 'Nováček')).toBe(true)

  await app.close()
})

test('notifies with the guest full name after a successful registration', async () => {
  const notify = vi.fn()
  const { app } = testServer({}, notify)
  const create = await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })
  expect(create.statusCode).toBe(201)
  expect(notify).toHaveBeenCalledTimes(1)
  expect(notify).toHaveBeenCalledWith('A B')
  await app.close()
})

test('does not notify when a registration is rejected', async () => {
  const notify = vi.fn()
  const { app } = testServer({}, notify)
  const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: {} })
  expect(res.statusCode).toBe(400)
  expect(notify).not.toHaveBeenCalled()
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

  const todayStr = today()
  const todayList = await app.inject({ method:'GET', url:`/api/registrations?date=${todayStr}` })
  expect(todayList.json().length).toBe(1)

  await app.close()
})

test('two concurrent registrations for the same name on the same day get distinct contract files', async () => {
  // Isolate this test's exportDir so its "same last/first name" collision
  // can't be masked (or spuriously caused) by other tests' leftover files
  // in the shared os.tmpdir().
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-race-'))
  const { app } = testServer({ exportDir })
  const body = { ...validBody(), last_name: 'Muster', first_name: 'Max' }

  const [res1, res2] = await Promise.all([
    app.inject({ method: 'POST', url: '/api/registrations', payload: body }),
    app.inject({ method: 'POST', url: '/api/registrations', payload: body }),
  ])

  expect(res1.statusCode).toBe(201)
  expect(res2.statusCode).toBe(201)

  const rows = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  expect(rows.length).toBe(2)

  const filenames = rows.map((r: any) => r.contract_pdf_filename).sort()
  expect(filenames.length).toBe(2)
  expect(filenames[0]).not.toBe(filenames[1])

  const dateStamp = today().replaceAll('-', '.')
  expect(filenames).toEqual([
    `${dateStamp}_Muster-Max (2).pdf`,
    `${dateStamp}_Muster-Max.pdf`,
  ])

  const vertraegeDir = path.join(exportDir, 'vertaege')
  for (const filename of filenames) {
    expect(fs.existsSync(path.join(vertraegeDir, filename))).toBe(true)
  }

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

test('DELETE /api/registrations/:id removes the row', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()

  const del = await app.inject({ method: 'DELETE', url: `/api/registrations/${id}` })
  expect(del.statusCode).toBe(204)

  const rows = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  expect(rows.find((r: any) => r.id === id)).toBeUndefined()

  await app.close()
})

test('DELETE /api/registrations/:id also removes the generated contract PDF', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-del-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()

  const rows = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  const filename = rows.find((r: any) => r.id === id).contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)
  expect(fs.existsSync(pdfPath)).toBe(true)

  const del = await app.inject({ method: 'DELETE', url: `/api/registrations/${id}` })
  expect(del.statusCode).toBe(204)
  expect(fs.existsSync(pdfPath)).toBe(false)

  await app.close()
})

test('DELETE /api/registrations/:id returns 404 for an unknown id', async () => {
  const { app } = testServer()

  const res = await app.inject({ method: 'DELETE', url: '/api/registrations/999999' })
  expect(res.statusCode).toBe(404)

  await app.close()
})

test('DELETE /api/registrations/:id broadcasts a "changed" SSE event', async () => {
  const { app } = testServer()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const addr = app.server.address()
  const base = typeof addr === 'string' ? addr : `http://127.0.0.1:${addr!.port}`

  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()

  const res = await fetch(`${base}/api/events`)
  const reader = res.body!.getReader()

  try {
    const del = await app.inject({ method: 'DELETE', url: `/api/registrations/${id}` })
    expect(del.statusCode).toBe(204)

    const chunk = await waitForSseChunk(reader, 'event: changed')
    expect(chunk).toContain('event: changed')
    // id here comes straight from the route param (a string), unlike the
    // POST handler's numeric lastInsertRowid — matches the PATCH broadcast's
    // quoting in manifest-update.test.ts.
    expect(chunk).toContain(`"id":"${id}"`)
  } finally {
    await reader.cancel().catch(() => {})
    await app.close()
  }
})

test('a heavy guest arrives with the surcharge and the price already right', async () => {
  const { app } = testServer()
  await app.inject({
    method: 'POST', url: '/api/registrations',
    payload: { ...validBody(), weight_kg: 104 },
  })
  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]

  // Derived once, here, rather than left as 'none' for someone to notice: the
  // row hits the manifest list with the surcharge and the money it implies.
  expect(row.weight_surcharge).toBe('over_100')
  expect(row.price).toBe(270 + 60)
  await app.close()
})

test('a guest below the threshold is charged nothing extra', async () => {
  const { app } = testServer()
  await app.inject({
    method: 'POST', url: '/api/registrations',
    payload: { ...validBody(), weight_kg: 89 },
  })
  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]
  expect(row.weight_surcharge).toBe('none')
  expect(row.price).toBe(270)
  await app.close()
})

test('the server timestamps the data-protection acknowledgement itself', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })
  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]

  // A tablet with a wrong clock must not get to decide when a guest consented.
  expect(isNaN(Date.parse(row.privacy_ack_at))).toBe(false)
  await app.close()
})

test('serves the data-protection text the club configured', async () => {
  const { app } = testServer({ privacyText: 'Verantwortlicher ist der Verein.' })
  const res = await app.inject({ method: 'GET', url: '/api/privacy' })
  expect(res.statusCode).toBe(200)
  expect(res.json().text).toBe('Verantwortlicher ist der Verein.')
  await app.close()
})

// The whole point of the stamp: the number the manifest types has to land on the
// PDF that is already sitting on disk, signed.
test('entering a voucher number prints it on the stored contract', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-stamp-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)

  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_number: 'GS-2026-0042' },
  })

  expect(await pdfContains(pdfPath, 'GS-2026-0042')).toBe(true)
  await app.close()
})

test('correcting the number leaves only the corrected one on the contract', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-restamp-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)

  const patch = (voucher_number: string | null) => app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_number },
  })
  await patch('GS-2026-0042')
  await patch('GS-2026-4711')

  expect(await pdfContains(pdfPath, 'GS-2026-4711')).toBe(true)
  // A typo corrected on screen must not stay legible on the printed contract.
  expect(await pdfContains(pdfPath, 'GS-2026-0042')).toBe(false)

  await patch(null)
  expect(await pdfContains(pdfPath, 'GS-2026-4711')).toBe(false)
  await app.close()
})

// Same reason as the voucher number: the master is assigned in the manifest,
// long after the guest signed, and the contract on disk names who flew them.
test('assigning a tandem master prints the name on the stored contract', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-master-stamp-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)

  const master = (await app.inject({
    method: 'POST', url: '/api/masters', payload: { name: 'Hans Gruber' },
  })).json()

  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { tandem_master_id: master.id },
  })

  expect(await pdfContains(pdfPath, 'Hans Gruber')).toBe(true)
  await app.close()
})

test('reassigning the jump leaves only the new master on the contract', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-master-restamp-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)

  const add = async (name: string) => (await app.inject({
    method: 'POST', url: '/api/masters', payload: { name },
  })).json().id
  const hans = await add('Hans Gruber')
  const karl = await add('Karl Berger')

  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { tandem_master_id: hans, payment_method: 'voucher', voucher_number: 'GS-3' },
  })
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { tandem_master_id: karl },
  })

  expect(await pdfContains(pdfPath, 'Karl Berger')).toBe(true)
  expect(await pdfContains(pdfPath, 'Hans Gruber')).toBe(false)
  // Both live in one content stream, so redrawing the master must not lose the
  // number that was already on the page.
  expect(await pdfContains(pdfPath, 'GS-3')).toBe(true)
  await app.close()
})

test('taking the master off the jump takes the name off the contract', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-master-clear-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)

  const master = (await app.inject({
    method: 'POST', url: '/api/masters', payload: { name: 'Hans Gruber' },
  })).json()

  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { tandem_master_id: master.id },
  })
  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { tandem_master_id: null },
  })

  expect(await pdfContains(pdfPath, 'Hans Gruber')).toBe(false)
  await app.close()
})

test('a save that does not touch the voucher number leaves the contract alone', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-nostamp-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)
  const before = fs.readFileSync(pdfPath)

  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`, payload: { load_number: 3 },
  })

  // Byte-identical: every save from the detail screen carries a voucher_number
  // and a tandem_master_id, and rewriting the signed document on each of them
  // would churn it for nothing.
  expect(fs.readFileSync(pdfPath).equals(before)).toBe(true)
  await app.close()
})

test('a missing contract file does not fail the save', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-gone-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations', payload: validBody(),
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  fs.rmSync(path.join(exportDir, 'vertaege', filename))

  // The row is the record that matters; losing a till entry to a missing PDF
  // would be the worse failure.
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_number: 'GS-9' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().voucher_number).toBe('GS-9')
  await app.close()
})
