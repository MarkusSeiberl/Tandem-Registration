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
const flyerSection = (rows: any[]) => sections(rows).find(s => s.title.includes('Kameraflieger'))

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

test('a camera flyer is paid per filmed service, both rates in one calculation', () => {
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

test('an overweight guest earns the tandemmaster the bonus on top of the jump', () => {
  const section = masterSection([jump(), jump({ weight_surcharge: 'over_90' })])
  expect(section?.entries).toEqual([
    { name: 'Seiberl Markus', calculation: '2 × 45,00 € + 1 × 15,00 €', amount: 105 },
  ])
  expect(section?.total).toBe(105)
})

test('the rates keep their order — jump, then 90 kg, then 100 kg', () => {
  const section = masterSection([
    jump({ weight_surcharge: 'over_100' }),
    jump({ weight_surcharge: 'over_90' }),
    jump(),
  ])
  expect(section?.entries[0].calculation).toBe('3 × 45,00 € + 1 × 15,00 € + 1 × 25,00 €')
  expect(section?.entries[0].amount).toBe(175)
})

test('a waived surcharge pays the master nothing extra', () => {
  // The manifest can set the field back to 'none' as an exception for the guest.
  // The bonus follows that decision, not the weight on the row.
  const section = masterSection([jump({ weight_surcharge: 'none', weight_kg: 95 })])
  expect(section?.entries[0].calculation).toBe('1 × 45,00 €')
  expect(section?.total).toBe(45)
})

test('a bonus rate of 0 adds no line to the calculation', () => {
  // A club that pays no bonus — and every day flown before the bonus existed —
  // would otherwise collect "× 0,00 €" lines that say nothing.
  const section = payoutSections(
    [jump({ weight_surcharge: 'over_90' }), jump({ weight_surcharge: 'over_100' })],
    MASTERS, FLYERS,
    { ...DEFAULT_PAYOUTS, weight_over_90: 0, weight_over_100: 0 },
  ).find(s => s.title.includes('Tandemmaster'))
  expect(section?.entries[0].calculation).toBe('2 × 45,00 €')
  expect(section?.total).toBe(90)
})

test('an unassigned jump carries its bonus into the ohne-Tandemmaster line', () => {
  const section = masterSection([
    jump({ tandem_master_id: null, weight_surcharge: 'over_100' }),
  ])
  expect(section?.entries).toEqual([
    { name: 'ohne Tandemmaster', calculation: '1 × 45,00 € + 1 × 25,00 €', amount: 70 },
  ])
})

test('the bonus reaches the master even when the guest flew on a voucher', () => {
  // A voucher never covers the weight surcharge, and the payout follows the jump
  // that was flown either way.
  const section = masterSection([
    jump({
      weight_surcharge: 'over_90',
      payment_method: 'voucher', voucher_service: 'jump', price: 40,
    }),
  ])
  expect(section?.entries[0].amount).toBe(60)
})

test('the overweight bonus is the master\'s alone — the camera flyer earns none', () => {
  // The flyer is beside the tandem, not under it: the guest's weight changes
  // nothing about their jump.
  const section = flyerSection([
    jump({ camera_flyer_id: 7, extra_booking: 'video', weight_surcharge: 'over_100' }),
  ])
  expect(section?.entries[0].calculation).toBe('1 × 60,00 €')
  expect(section?.total).toBe(60)
})
