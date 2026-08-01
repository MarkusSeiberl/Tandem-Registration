import { test, expect } from 'vitest'
import { payoutSections } from '../src/server/payouts'
import { DEFAULT_PAYOUTS } from '../src/server/config'

const MASTERS = new Map([[1, 'Seiberl Markus'], [2, 'Gruber Hans']])
const FLYERS = new Map([[7, 'Hofer Lisa'], [8, 'Aigner Paul']])

// One jump, only the fields the payout rule reads.
function jump(fields: Record<string, unknown> = {}) {
  return { tandem_master_id: 1, camera_flyer_id: null, extra_booking: 'none', ...fields }
}

const sections = (rows: any[]) => payoutSections(rows, MASTERS, FLYERS, DEFAULT_PAYOUTS)
const masterSection = (rows: any[]) => sections(rows).find(s => s.title.includes('Tandemmaster'))
const flyerSection = (rows: any[]) => sections(rows).find(s => s.title.includes('Videoflieger'))

test('a tandemmaster earns the flat rate once per jump', () => {
  const section = masterSection([jump(), jump(), jump()])
  expect(section?.entries).toEqual([
    { name: 'Seiberl Markus', calculation: '3 × 45,00 €', amount: 135 },
  ])
  expect(section?.total).toBe(135)
})

test('each tandemmaster gets their own line, sorted by name', () => {
  const section = masterSection([jump(), jump({ tandem_master_id: 2 }), jump()])
  expect(section?.entries.map(e => e.name)).toEqual(['Gruber Hans', 'Seiberl Markus'])
  expect(section?.entries.map(e => e.amount)).toEqual([45, 90])
  expect(section?.total).toBe(135)
})

test('a video flyer is paid per filmed service, both rates in one calculation', () => {
  const section = flyerSection([
    jump({ camera_flyer_id: 7, extra_booking: 'video' }),
    jump({ camera_flyer_id: 7, extra_booking: 'video_photo' }),
  ])
  expect(section?.entries).toEqual([
    { name: 'Hofer Lisa', calculation: '1 × 60,00 € + 1 × 80,00 €', amount: 140 },
  ])
})

test('jumps without video earn the flyer nothing', () => {
  expect(flyerSection([jump(), jump()])).toBeUndefined()
})

test('the payout follows the jump, not the money — voucher and uncollected rows count', () => {
  const section = masterSection([
    jump({ payment_method: 'voucher', voucher_service: 'jump', price: 0, paid_at: null }),
    jump({ payment_method: 'cash', paid_at: null }),
  ])
  expect(section?.total).toBe(90)
})

test('a voucher-covered video still pays the flyer, read from the flown service', () => {
  const section = flyerSection([
    jump({
      camera_flyer_id: 7, extra_booking: 'video_photo',
      payment_method: 'voucher', voucher_service: 'jump_video_photo', price: 0,
    }),
  ])
  expect(section?.entries[0]).toEqual({ name: 'Hofer Lisa', calculation: '1 × 80,00 €', amount: 80 })
})

test('a manual price correction does not change the flat rate', () => {
  const section = masterSection([jump({ price: 5, price_override: 1 })])
  expect(section?.entries[0].amount).toBe(45)
})

test('jumps with nobody assigned get their own line, listed last', () => {
  const section = masterSection([jump({ tandem_master_id: null }), jump({ tandem_master_id: 2 })])
  expect(section?.entries.map(e => e.name)).toEqual(['Gruber Hans', 'ohne Tandemmaster'])
})

test('video booked without a flyer is listed rather than dropped', () => {
  const section = flyerSection([
    jump({ camera_flyer_id: null, extra_booking: 'video' }),
    jump({ camera_flyer_id: 7, extra_booking: 'video' }),
  ])
  expect(section?.entries.map(e => e.name)).toEqual(['Hofer Lisa', 'ohne Kameraflieger'])
  expect(section?.total).toBe(120)
})

test('an id with no matching name falls back to the unassigned line', () => {
  const section = masterSection([jump({ tandem_master_id: 99 })])
  expect(section?.entries[0].name).toBe('ohne Tandemmaster')
})

test('a day without jumps produces no sections at all', () => {
  expect(sections([])).toEqual([])
})

test('changed rates are taken from the settings, not hardcoded', () => {
  const section = payoutSections([jump(), jump()], MASTERS, FLYERS,
    { ...DEFAULT_PAYOUTS, tandem_master: 50 })[0]
  expect(section.entries[0]).toEqual({ name: 'Seiberl Markus', calculation: '2 × 50,00 €', amount: 100 })
})

test('an amount with cents is written the German way', () => {
  const section = payoutSections([jump()], MASTERS, FLYERS,
    { ...DEFAULT_PAYOUTS, tandem_master: 1234.5 })[0]
  expect(section.entries[0].calculation).toBe('1 × 1.234,50 €')
})
