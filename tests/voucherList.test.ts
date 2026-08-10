import { test, expect } from 'vitest'
import { normaliseVoucherNumber, serviceFromArt } from '../src/server/voucherList'

test('the same voucher written three ways normalises to one key', () => {
  const canonical = normaliseVoucherNumber('26-001')
  expect(normaliseVoucherNumber('26-1')).toBe(canonical)
  expect(normaliseVoucherNumber('26 001')).toBe(canonical)
  expect(normaliseVoucherNumber('  26-001  ')).toBe(canonical)
  expect(normaliseVoucherNumber('26/001')).toBe(canonical)
})

test('different vouchers stay different', () => {
  // Joining the groups keeps the separator meaningful: 26001 is not 26-001.
  expect(normaliseVoucherNumber('26001')).not.toBe(normaliseVoucherNumber('26-001'))
  expect(normaliseVoucherNumber('26-002')).not.toBe(normaliseVoucherNumber('26-001'))
  expect(normaliseVoucherNumber('25-001')).not.toBe(normaliseVoucherNumber('26-001'))
})

test('a group that is only zeros survives normalising', () => {
  expect(normaliseVoucherNumber('26-0')).toBe('26-0')
})

test('letters are kept and folded to upper case', () => {
  expect(normaliseVoucherNumber('gs26-001')).toBe(normaliseVoucherNumber('GS26-001'))
})

test('Art maps to the service it covers', () => {
  expect(serviceFromArt('Tandem')).toEqual({ service: 'jump', isAddOn: false })
  expect(serviceFromArt('Tandem + Video')).toEqual({ service: 'jump_video', isAddOn: false })
  expect(serviceFromArt('Tandem + Video + Foto'))
    .toEqual({ service: 'jump_video_photo', isAddOn: false })
})

test('an Art without Tandem is an add-on, not a jump voucher', () => {
  // "Video + Foto zu GS25-2" tops up another voucher; reading it as a
  // Sprung+Video+Foto voucher would credit a jump nobody paid for.
  expect(serviceFromArt('Video + Foto zu GS25-2')).toEqual({ service: null, isAddOn: true })
})

test('an Art nobody recognises compares against nothing', () => {
  expect(serviceFromArt('Sonderaktion')).toEqual({ service: null, isAddOn: false })
  expect(serviceFromArt(null)).toEqual({ service: null, isAddOn: false })
  expect(serviceFromArt('')).toEqual({ service: null, isAddOn: false })
})
