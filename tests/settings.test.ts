import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

test('get/put settings', async () => {
  const { app, cfgRef } = testServer({ exportDir: '/tmp/x' })
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '/tmp/y', contractText: 'Hallo' } })
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().contractText).toBe('Hallo')
  expect(cfgRef.current.exportDir).toBe('/tmp/y')
  await app.close()
})

test('put settings rejects empty exportDir', async () => {
  const { app, cfgRef } = testServer({ exportDir: '/tmp/x' })
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '' } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('exportDir ungültig')
  expect(cfgRef.current.exportDir).toBe('/tmp/x')
  await app.close()
})

test('put settings accepts valid exportDir', async () => {
  const { app, cfgRef } = testServer({ exportDir: '/tmp/x' })
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '/tmp/z' } })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.exportDir).toBe('/tmp/z')
  await app.close()
})

test('get settings exposes the price table', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().prices).toEqual({
    jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60,
  })
  await app.close()
})

test('put settings stores new prices', async () => {
  const { app, cfgRef } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings',
    payload: { prices: { jump: 290, video: 110, video_photo: 130, weight_over_90: 45, weight_over_100: 65 } }
  })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.prices.jump).toBe(290)
  expect(cfgRef.current.prices.weight_over_100).toBe(65)
  await app.close()
})

test('put settings merges prices instead of replacing the whole block', async () => {
  const { app, cfgRef } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings', payload: { prices: { jump: 290 } }
  })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.prices.jump).toBe(290)
  // An older client that does not know about the surcharges must not wipe them.
  expect(cfgRef.current.prices.weight_over_90).toBe(40)
  await app.close()
})

test('put settings leaves prices untouched when the body has none', async () => {
  const { app, cfgRef } = testServer()
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { jumpLocation: 'Freistadt' } })
  expect(cfgRef.current.prices.jump).toBe(270)
  await app.close()
})

test('get settings exposes the payout rates', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().payouts).toEqual({ tandem_master: 45, video: 60, video_photo: 80 })
  await app.close()
})

test('put settings stores new payout rates', async () => {
  const { app, cfgRef } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings',
    payload: { payouts: { tandem_master: 50, video: 65, video_photo: 85 } },
  })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.payouts).toEqual({ tandem_master: 50, video: 65, video_photo: 85 })
  await app.close()
})

test('put settings merges payouts instead of replacing the whole block', async () => {
  const { app, cfgRef } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings', payload: { payouts: { tandem_master: 50 } },
  })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.payouts.tandem_master).toBe(50)
  expect(cfgRef.current.payouts.video_photo).toBe(80)
  await app.close()
})

test('put settings leaves payouts untouched when the body has none', async () => {
  const { app, cfgRef } = testServer()
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { jumpLocation: 'Freistadt' } })
  expect(cfgRef.current.payouts.tandem_master).toBe(45)
  await app.close()
})

test('put settings rejects a non-numeric or negative payout rate', async () => {
  const { app, cfgRef } = testServer()
  for (const bad of [{ tandem_master: 'viel' }, { tandem_master: -1 }, { video: null }]) {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { payouts: bad } })
    expect(res.statusCode).toBe(400)
  }
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { payouts: 'gratis' } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('Vergütung ungültig')
  expect(cfgRef.current.payouts.tandem_master).toBe(45)
  await app.close()
})

test('put settings rejects a non-numeric or negative price', async () => {
  const { app, cfgRef } = testServer()
  for (const bad of [{ jump: 'teuer' }, { jump: -1 }, { video: null }]) {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { prices: bad } })
    expect(res.statusCode).toBe(400)
  }
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { prices: 'kostenlos' } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('Preise ungültig')
  expect(cfgRef.current.prices.jump).toBe(270)
  await app.close()
})

test('put settings rejects a non-string voucherListPath', async () => {
  const { app, cfgRef } = testServer({ voucherListPath: '' })
  for (const bad of [123, null, { path: 'test' }, ['test']]) {
    const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { voucherListPath: bad } })
    expect(res.statusCode).toBe(400)
  }
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { voucherListPath: 123 } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('voucherListPath ungültig')
  expect(cfgRef.current.voucherListPath).toBe('')
  await app.close()
})

test('put settings accepts an empty voucherListPath', async () => {
  const { app, cfgRef } = testServer({ voucherListPath: 'C:/Verein/list.xlsx' })
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { voucherListPath: '' } })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.voucherListPath).toBe('')
  await app.close()
})

test('the voucher list path round-trips through the settings', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings',
    payload: { voucherListPath: 'C:/Verein/Tandemliste.xlsx' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().voucherListPath).toBe('C:/Verein/Tandemliste.xlsx')
  await app.close()
})

test('the voucher list path starts out empty, which switches the feature off', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().voucherListPath).toBe('')
  await app.close()
})
