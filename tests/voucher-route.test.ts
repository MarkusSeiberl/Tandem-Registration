import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'
import { writeVoucherFile } from './helpers/voucherFile'
import { clearVoucherListCache } from '../src/server/voucherList'

async function serverWithList(rows: Parameters<typeof writeVoucherFile>[0]) {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile(rows)
  return testServer({ voucherListPath })
}

test('reports a paid, unredeemed voucher with its details', async () => {
  const { app } = await serverWithList([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem + Video', betrag: 355 },
  ])
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-1' })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({
    configured: true, readable: true, status: 'ok',
    number: '26-001', amount: 355, art: 'Tandem + Video',
    service: 'jump_video', isAddOn: false, redeemedAt: null,
  })
  expect(res.json().paidAt).toContain('2026-01-14')
  await app.close()
})

test('reports unpaid, cancelled and unknown vouchers', async () => {
  const { app } = await serverWithList([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' },
  ])
  const status = async (number: string) =>
    (await app.inject({ method: 'GET', url: `/api/voucher?number=${number}` })).json()

  expect((await status('26-007')).status).toBe('unpaid')
  expect((await status('26-009'))).toMatchObject({ status: 'cancelled', paidText: 'STORNO' })
  expect((await status('99-999')).status).toBe('not_found')
  await app.close()
})

test('an unset path reports the feature as switched off, not as an error', async () => {
  const { app } = testServer({ voucherListPath: '' })
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-001' })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ configured: false, readable: false, status: null })
  await app.close()
})

test('an unreadable file reports a German message and never a 500', async () => {
  clearVoucherListCache()
  const { app } = testServer({ voucherListPath: 'C:/nope/keine-datei.xlsx' })
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-001' })

  expect(res.statusCode).toBe(200)
  expect(res.json().configured).toBe(true)
  expect(res.json().readable).toBe(false)
  expect(typeof res.json().error).toBe('string')
  await app.close()
})

test('a missing number is rejected without touching the file', async () => {
  const { app } = testServer({ voucherListPath: '' })
  const res = await app.inject({ method: 'GET', url: '/api/voucher' })
  expect(res.statusCode).toBe(400)
  await app.close()
})
