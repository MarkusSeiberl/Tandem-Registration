import { describe, expect, it } from 'vitest'
import { FIELD_CHAIN, firstErrorField, nextField, prevField } from './useFieldChain'

describe('FIELD_CHAIN', () => {
  it('lists all twelve fields in the order they appear in the form', () => {
    expect(FIELD_CHAIN).toEqual([
      'firstName',
      'lastName',
      'gender',
      'age',
      'height',
      'weight',
      'street',
      'postalCode',
      'city',
      'email',
      'phone',
      'voucherNumber',
    ])
  })
})

describe('nextField', () => {
  it('moves to the following field', () => {
    expect(nextField('firstName')).toBe('lastName')
  })

  it('steps through the gender radio group like any other field', () => {
    expect(nextField('lastName')).toBe('gender')
    expect(nextField('gender')).toBe('age')
  })

  it('carries on from the last mandatory field into the optional one', () => {
    expect(nextField('phone')).toBe('voucherNumber')
  })

  it('stops at the last field instead of wrapping around', () => {
    expect(nextField('voucherNumber')).toBeNull()
  })
})

describe('prevField', () => {
  it('moves to the preceding field', () => {
    expect(prevField('lastName')).toBe('firstName')
  })

  it('stops at the first field instead of wrapping around', () => {
    expect(prevField('firstName')).toBeNull()
  })
})

describe('firstErrorField', () => {
  it('returns the earliest field in chain order, not in object order', () => {
    // `phone` is listed first here, but `age` comes earlier in the form.
    expect(firstErrorField({ phone: 'Telefon fehlt', age: 'Alter ungültig' })).toBe('age')
  })

  it('returns null when there are no errors', () => {
    expect(firstErrorField({})).toBeNull()
  })
})
