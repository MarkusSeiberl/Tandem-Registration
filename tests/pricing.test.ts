import { test, expect } from 'vitest'
import {
  collectedVia, computePrice, priceLines, surchargeForWeight, voucherCovered, voucherTopup,
  voucherValue,
} from '../src/server/pricing'
import { DEFAULT_PRICES } from '../src/server/config'

const p = DEFAULT_PRICES

test('a cash guest without extras pays the jump price', () => {
  expect(computePrice({ payment_method: 'cash', extra_booking: 'none', weight_surcharge: 'none' }, p))
    .toBe(270)
})

test('a registration the manifest has not touched yet is priced as a paying guest', () => {
  expect(computePrice({}, p)).toBe(270)
})

test('extras are added to the jump price', () => {
  expect(computePrice({ payment_method: 'card', extra_booking: 'video' }, p)).toBe(370)
  expect(computePrice({ payment_method: 'card', extra_booking: 'video_photo' }, p)).toBe(390)
})

test('the weight surcharge is added on top', () => {
  expect(computePrice({ payment_method: 'cash', weight_surcharge: 'over_90' }, p)).toBe(310)
  expect(computePrice({ payment_method: 'cash', weight_surcharge: 'over_100' }, p)).toBe(330)
})

test('a voucher is worth its service at current list prices', () => {
  expect(voucherValue('jump', p)).toBe(270)
  expect(voucherValue('jump_video', p)).toBe(370)
  expect(voucherValue('jump_video_photo', p)).toBe(390)
  expect(voucherValue(null, p)).toBe(0)
})

test('a voucher used exactly as issued costs nothing', () => {
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'none' }, p)).toBe(0)
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump_video', extra_booking: 'video' }, p)).toBe(0)
})

test('a jump voucher plus video costs the video', () => {
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'video' }, p)).toBe(100)
})

test('upgrading from a jump+video voucher to video+photo costs the difference', () => {
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump_video', extra_booking: 'video_photo' }, p))
    .toBe(20)
})

test('a voucher worth more than the service flown is not paid out in cash', () => {
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump_video_photo', extra_booking: 'none' }, p))
    .toBe(0)
})

test('a voucher never covers the weight surcharge', () => {
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'none', weight_surcharge: 'over_100' }, p))
    .toBe(60)
})

test('a voucher service is ignored unless the guest actually pays by voucher', () => {
  // A stale value left on the row must not discount a cash guest.
  expect(computePrice(
    { payment_method: 'cash', voucher_service: 'jump_video', extra_booking: 'video' }, p)).toBe(370)
})

test('everything at once', () => {
  expect(computePrice(
    { payment_method: 'cash', extra_booking: 'video_photo', weight_surcharge: 'over_90' }, p))
    .toBe(390 + 40)
})

test('the price table from the settings is what is applied', () => {
  const other = { ...DEFAULT_PRICES, jump: 300, video: 150 }
  expect(computePrice({ payment_method: 'cash', extra_booking: 'video' }, other)).toBe(450)
  // An old voucher is honoured at today's prices, so an unchanged booking stays free.
  expect(computePrice(
    { payment_method: 'voucher', voucher_service: 'jump_video', extra_booking: 'video' }, other))
    .toBe(0)
})

test('a cash or card guest lands in that till', () => {
  expect(collectedVia({ payment_method: 'cash' })).toBe('cash')
  expect(collectedVia({ payment_method: 'card' })).toBe('card')
})

test('a voucher guest lands in the till their top-up was paid into', () => {
  expect(collectedVia({ payment_method: 'voucher', voucher_payment_method: 'cash' })).toBe('cash')
  expect(collectedVia({ payment_method: 'voucher', voucher_payment_method: 'card' })).toBe('card')
})

test('an unrecorded till is reported as unknown, not silently as cash', () => {
  expect(collectedVia({ payment_method: 'voucher', voucher_payment_method: null })).toBeNull()
  expect(collectedVia({ payment_method: null })).toBeNull()
  // A voucher is never a till of its own — it moves no money.
  expect(collectedVia({ payment_method: 'voucher' })).toBeNull()
})

test('the breakdown names every line the total is made of', () => {
  const lines = priceLines(
    { payment_method: 'cash', extra_booking: 'video', weight_surcharge: 'over_90' }, p)
  expect(lines.map(l => l.label)).toEqual(['Sprung', 'Video', 'ab 90 kg'])
  expect(lines.map(l => l.amount)).toEqual([270, 100, 40])
})

test('the breakdown shows the voucher as a deduction and always adds up', () => {
  const lines = priceLines(
    { payment_method: 'voucher', voucher_service: 'jump_video', extra_booking: 'video_photo' }, p)
  expect(lines.map(l => l.label)).toEqual(['Sprung', 'Video+Foto', 'Gutschein'])
  expect(lines.map(l => l.amount)).toEqual([270, 120, -370])
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(20)
})

test('an over-valued voucher is capped so the lines still add up to the total', () => {
  const lines = priceLines(
    { payment_method: 'voucher', voucher_service: 'jump_video_photo', extra_booking: 'none',
      weight_surcharge: 'over_90' }, p)
  expect(lines.map(l => l.amount)).toEqual([270, -270, 40])
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(40)
})

test('the price rise since the voucher was bought is only charged when asked for', () => {
  // Bought as a plain jump for 240, honoured today at 270.
  const bought = { payment_method: 'voucher' as const, voucher_service: 'jump' as const,
    extra_booking: 'none' as const, voucher_amount: 240 }
  // The club eating the rise is the default, and stays the default.
  expect(computePrice(bought, p)).toBe(0)
  expect(computePrice({ ...bought, voucher_topup: 1 }, p)).toBe(30)
})

test('the difference is a line of its own, so the breakdown still adds up', () => {
  const lines = priceLines(
    { payment_method: 'voucher', voucher_service: 'jump', extra_booking: 'video',
      voucher_topup: 1, voucher_amount: 240 }, p)
  expect(lines.map(l => l.label))
    .toEqual(['Sprung', 'Video', 'Gutschein', 'Gutschein-Differenz'])
  expect(lines.map(l => l.amount)).toEqual([270, 100, -270, 30])
  expect(lines.reduce((s, l) => s + l.amount, 0)).toBe(130)
})

test('the difference is measured against what the voucher actually covers', () => {
  // A jump_video_photo voucher on a guest who only takes the jump: 270 comes
  // off the bill, not the 390 the voucher would be worth in the abstract. So a
  // 350 voucher is worth MORE than what it covers here, and nothing is charged.
  const capped = { payment_method: 'voucher' as const,
    voucher_service: 'jump_video_photo' as const, extra_booking: 'none' as const }
  expect(voucherCovered(capped, p)).toBe(270)
  expect(voucherTopup({ ...capped, voucher_topup: 1, voucher_amount: 350 }, p)).toBe(0)
})

test('a voucher bought above today’s price is never refunded', () => {
  expect(voucherTopup({ payment_method: 'voucher', voucher_service: 'jump',
    extra_booking: 'none', voucher_topup: 1, voucher_amount: 300 }, p)).toBe(0)
})

test('a ticked box without an amount from the list charges nothing', () => {
  // The club's file was unreachable when the row was saved. Guessing a
  // difference from an amount nobody read would be inventing money.
  expect(computePrice({ payment_method: 'voucher', voucher_service: 'jump',
    extra_booking: 'none', voucher_topup: 1, voucher_amount: null }, p)).toBe(0)
})

// The thresholds the club prints on its price list: "ab 90 kg" includes 90.
test('the surcharge follows the weight at the printed thresholds', () => {
  expect(surchargeForWeight(89)).toBe('none')
  expect(surchargeForWeight(89.9)).toBe('none')
  expect(surchargeForWeight(90)).toBe('over_90')
  expect(surchargeForWeight(99)).toBe('over_90')
  expect(surchargeForWeight(100)).toBe('over_100')
  expect(surchargeForWeight(140)).toBe('over_100')
})

test('a missing weight buys no surcharge', () => {
  // Nothing in the schema guarantees a number here for an old row; charging a
  // guest 60 € for a NaN would be the worst possible reading of "unknown".
  expect(surchargeForWeight(NaN)).toBe('none')
  expect(surchargeForWeight(undefined as unknown as number)).toBe('none')
})
