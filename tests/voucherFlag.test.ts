import { test, expect } from 'vitest'
import { promises as fs } from 'fs'
import { testServer } from './helpers/testServer'
import { writeVoucherFile } from './helpers/voucherFile'
import { clearVoucherListCache } from '../src/server/voucherList'

const validBody = (voucher_number?: string) => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', accepted_terms: true, privacy_ack: true,
  ...(voucher_number ? { voucher_number } : {}),
})

const PAID = new Date(Date.UTC(2026, 0, 14))
const REDEEMED = new Date(Date.UTC(2026, 6, 12))

async function setup() {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: PAID, art: 'Tandem' },
    { lfdNr: '26-002', einzahlDat: null, art: 'Tandem' },
    { lfdNr: '26-003', einzahlDat: PAID, art: 'Tandem', eingeloest: REDEEMED },
    { lfdNr: '26-004', einzahlDat: 'STORNO', art: 'Tandem' },
  ])
  return { ...testServer({ voucherListPath }), voucherListPath }
}

async function register(app: Awaited<ReturnType<typeof setup>>['app'], number?: string) {
  const res = await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody(number) })
  return res.json().id as number
}

async function rows(app: Awaited<ReturnType<typeof setup>>['app']) {
  return (await app.inject({ method: 'GET', url: '/api/registrations' })).json() as any[]
}

test('the list flags every voucher the club list does not accept', async () => {
  const { app } = await setup()
  const ok = await register(app, '26-001')
  const unpaid = await register(app, '26-002')
  const redeemed = await register(app, '26-003')
  const cancelled = await register(app, '26-004')
  const unknown = await register(app, '99-999')
  const none = await register(app)

  const byId = new Map((await rows(app)).map((r) => [r.id, r]))
  expect(byId.get(ok).voucher_check_status).toBeNull()
  expect(byId.get(unpaid).voucher_check_status).toBe('unpaid')
  expect(byId.get(redeemed).voucher_check_status).toBe('redeemed')
  expect(byId.get(redeemed).voucher_check_detail).toBe('2026-07-12')
  expect(byId.get(cancelled).voucher_check_status).toBe('cancelled')
  expect(byId.get(cancelled).voucher_check_detail).toBe('STORNO')
  expect(byId.get(unknown).voucher_check_status).toBe('not_found')
  expect(byId.get(none).voucher_check_status).toBeNull()
  await app.close()
})

test('a payment the club enters mid-day clears the flag on the next load', async () => {
  const { app, cfgRef } = await setup()
  const id = await register(app, '26-002')
  expect((await rows(app))[0].voucher_check_status).toBe('unpaid')

  clearVoucherListCache()
  cfgRef.current.voucherListPath = await writeVoucherFile([
    { lfdNr: '26-002', einzahlDat: PAID, art: 'Tandem' },
  ])
  const row = (await rows(app)).find((r) => r.id === id)
  expect(row.voucher_check_status).toBeNull()
  await app.close()
})

// Once our own redemption reaches the file, a live check would call the voucher
// redeemed and flag the very row that redeemed it.
test('a collected row keeps the verdict it was collected under', async () => {
  const { app, cfgRef } = await setup()
  const id = await register(app, '26-001')
  await rows(app)
  await app.inject({ method: 'PATCH', url: `/api/registrations/${id}`, payload: { paid: true } })

  clearVoucherListCache()
  cfgRef.current.voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: PAID, art: 'Tandem', eingeloest: new Date() },
  ])
  expect((await rows(app))[0].voucher_check_status).toBeNull()
  await app.close()
})

test('a re-opened row whose redemption is already in the file is not re-checked', async () => {
  const { app, cfgRef, db } = await setup()
  const id = await register(app, '26-001')
  await rows(app)
  db.prepare(`UPDATE registrations SET voucher_redeemed_at='x', voucher_redeem_synced_at='x'
    WHERE id=?`).run(id)

  clearVoucherListCache()
  cfgRef.current.voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: PAID, art: 'Tandem', eingeloest: new Date() },
  ])
  expect((await rows(app))[0].voucher_check_status).toBeNull()
  await app.close()
})

test('changing the number in the manifest re-checks it, clearing it drops the flag', async () => {
  const { app } = await setup()
  const id = await register(app)
  const patch = async (voucher_number: string | null) => (await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { payment_method: 'voucher', voucher_number, paid: true },
  })).json()

  // Collected, so only the PATCH can have stored these.
  expect((await patch('26-002')).voucher_check_status).toBe('unpaid')
  expect((await patch('26-001')).voucher_check_status).toBeNull()
  expect((await patch('99-999')).voucher_check_status).toBe('not_found')
  const cleared = await patch(null)
  expect(cleared.voucher_check_status).toBeNull()
  expect(cleared.voucher_check_detail).toBeNull()
  await app.close()
})

test('an unreadable list leaves the stored verdict alone', async () => {
  const { app, voucherListPath } = await setup()
  await register(app, '26-002')
  expect((await rows(app))[0].voucher_check_status).toBe('unpaid')

  clearVoucherListCache()
  await fs.unlink(voucherListPath)
  expect((await rows(app))[0].voucher_check_status).toBe('unpaid')
  await app.close()
})

test('a list switched off shows no flags from the days it was on', async () => {
  const { app, cfgRef } = await setup()
  await register(app, '26-002')
  expect((await rows(app))[0].voucher_check_status).toBe('unpaid')

  cfgRef.current.voucherListPath = ''
  const row = (await rows(app))[0]
  expect(row.voucher_check_status).toBeNull()
  expect(row.voucher_check_detail).toBeNull()
  await app.close()
})
