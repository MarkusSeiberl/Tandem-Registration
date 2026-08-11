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
  const check = async (number: string) =>
    app.inject({ method: 'GET', url: `/api/voucher?number=${number}` })

  const unpaid = await check('26-007')
  expect(unpaid.statusCode).toBe(200)
  expect(unpaid.json().status).toBe('unpaid')

  const cancelled = await check('26-009')
  expect(cancelled.statusCode).toBe(200)
  expect(cancelled.json()).toMatchObject({ status: 'cancelled', paidText: 'STORNO' })

  const unknown = await check('99-999')
  expect(unknown.statusCode).toBe(200)
  expect(unknown.json().status).toBe('not_found')
  await app.close()
})

test('reports two rows sharing a normalised number as ambiguous', async () => {
  const { app } = await serverWithList([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem', betrag: 250 },
    { lfdNr: '26-1', einzahlDat: new Date('2026-01-15'), art: 'Tandem', betrag: 250 },
  ])
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-001' })

  expect(res.statusCode).toBe(200)
  expect(res.json().status).toBe('ambiguous')
  await app.close()
})

test('reports a voucher already marked as redeemed, with the redemption date', async () => {
  const { app } = await serverWithList([
    {
      lfdNr: '26-001',
      einzahlDat: new Date('2026-01-14'),
      art: 'Tandem',
      betrag: 250,
      eingeloest: new Date('2026-02-01'),
    },
  ])
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-001' })

  expect(res.statusCode).toBe(200)
  expect(res.json().status).toBe('redeemed')
  expect(res.json().redeemedAt).toContain('2026-02-01')
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

// The row the banner is meant to count: redeemed for us, not yet in the file.
const PENDING_ROW = `INSERT INTO registrations
  (first_name,last_name,created_at,jump_date,voucher_number,voucher_redeemed_at)
  VALUES ('A','B','2026-08-10T10:00:00.000Z','2026-08-10','26-001',
   '2026-08-10T10:00:00.000Z')`

test('the pending count is what the manifest shows in its banner', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const { app, db } = testServer({ voucherListPath })
  db.prepare(PENDING_ROW).run()

  const res = await app.inject({ method: 'GET', url: '/api/voucher/pending' })
  expect(res.json().count).toBe(1)
  await app.close()
})

test('a redemption whose voucher number was cleared is not counted as open', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const { app, db } = testServer({ voucherListPath })
  // The detail screen sends voucher_number: null as soon as the payment method
  // moves off Gutschein. The export sweep has no number to write, so a banner
  // counting this row would ask for something no export could ever deliver.
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,created_at,jump_date,voucher_redeemed_at)
    VALUES ('A','B','2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z')`).run()

  const res = await app.inject({ method: 'GET', url: '/api/voucher/pending' })
  expect(res.json().count).toBe(0)
  await app.close()
})

test('an unset path shows no banner, whatever the rows still say', async () => {
  clearVoucherListCache()
  // Clearing the path is how a club switches the feature off after trouble.
  // Rows from the days it was in use must not keep a warning on screen that
  // nobody can act on.
  const { app, db } = testServer({ voucherListPath: '' })
  db.prepare(PENDING_ROW).run()

  const res = await app.inject({ method: 'GET', url: '/api/voucher/pending' })
  expect(res.json().count).toBe(0)
  await app.close()
})
