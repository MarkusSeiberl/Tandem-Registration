import { describe, expect, it } from 'vitest'
import {
  difference, expectedTills, formatAmountInput, groupTandems, needsReason, openCount, parseAmount,
} from './cashMath'
import { makeRow } from './testRows'

const PAID = '2026-07-09T12:00:00.000Z'

describe('groupTandems', () => {
  const open = makeRow({ id: 1, price: 259 })
  const openVoucherTopup = makeRow({ id: 2, price: 30, payment_method: 'voucher' })
  const freeVoucher = makeRow({ id: 3, price: 0, payment_method: 'voucher' })
  const paidNoMethod = makeRow({ id: 4, price: 259, paid_at: PAID })
  const paidCash = makeRow({ id: 5, price: 259, paid_at: PAID, payment_method: 'cash' })
  const paidFreeVoucher = makeRow({ id: 6, price: 0, paid_at: PAID, payment_method: 'voucher' })
  const groups = groupTandems([open, openVoucherTopup, freeVoucher, paidNoMethod, paidCash, paidFreeVoucher])

  it('puts open tandems that owe money in open', () => {
    expect(groups.open.map((r) => r.id)).toEqual([1, 2])
  })
  it('puts collected tandems without a till in noMethod', () => {
    expect(groups.noMethod.map((r) => r.id)).toEqual([4])
  })
  it('puts open tandems with nothing to pay in freeVoucher', () => {
    expect(groups.freeVoucher.map((r) => r.id)).toEqual([3])
  })
})

describe('expectedTills', () => {
  it('sums collected money by the till it landed in, voucher top-ups by their own till', () => {
    const rows = [
      makeRow({ id: 1, price: 1295, paid_at: PAID, payment_method: 'cash' }),
      makeRow({ id: 2, price: 500, paid_at: PAID, payment_method: 'card' }),
      makeRow({ id: 3, price: 48, paid_at: PAID, payment_method: 'voucher', voucher_payment_method: 'card' }),
      makeRow({ id: 4, price: 259 }), // open: not in any till yet
      makeRow({ id: 5, price: 100, paid_at: PAID }), // collected, no till
    ]
    expect(expectedTills(rows)).toEqual({ cash: 1295, card: 548 })
  })
})

describe('parseAmount', () => {
  it.each([
    ['1.300,50', 1300.5],
    ['1300,5', 1300.5],
    ['1300.50', 1300.5],
    ['1 300', 1300],
    ['0', 0],
    ['  548  ', 548],
    ['', null],
    ['   ', null],
    ['abc', 'invalid'],
    ['-5', 'invalid'],
    ['1,234', 'invalid'],
    ['1.2.3', 'invalid'],
  ] as const)('reads %j as %j', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })
})

describe('formatAmountInput', () => {
  it('writes an amount the way the field reads it back', () => {
    expect(formatAmountInput(1300)).toBe('1.300,00')
    expect(formatAmountInput(548.5)).toBe('548,50')
    expect(formatAmountInput(null)).toBe('')
    expect(parseAmount(formatAmountInput(12345.67))).toBe(12345.67)
  })
})

describe('difference', () => {
  it('is counted minus expected, in cents', () => {
    expect(difference(1300, 1295)).toBe(5)
    expect(difference(1290, 1295)).toBe(-5)
    expect(difference(0.1 + 0.2, 0.3)).toBe(0)
    expect(difference(null, 5)).toBeNull()
  })
})

describe('needsReason', () => {
  const expected = { cash: 100, card: 50 }
  it('is false when every counted till matches', () => {
    expect(needsReason({ cash: 100, card: 50 }, expected)).toBe(false)
  })
  it('is false for tills nobody counted', () => {
    expect(needsReason({ cash: null, card: null }, expected)).toBe(false)
  })
  it('is true when any counted till differs by a cent or more', () => {
    expect(needsReason({ cash: 100.01, card: null }, expected)).toBe(true)
    expect(needsReason({ cash: null, card: 49 }, expected)).toBe(true)
  })
})

describe('openCount', () => {
  it('counts every tandem not yet collected, whatever it costs', () => {
    expect(openCount([makeRow({ id: 1, price: 0 }), makeRow({ id: 2, price: 5 }),
      makeRow({ id: 3, paid_at: PAID })])).toBe(2)
  })
})
