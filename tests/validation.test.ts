import { test, expect } from 'vitest'
import { validateGuest } from '../src/server/validation'

const base = { first_name:'A', last_name:'B', age:30, weight_kg:80,
  address:'X 1', email:'a@b.de', phone:'0660', signature_png:'data:image/png;base64,x',
  accepted_terms:true }

test('accepts valid input', () => {
  expect(validateGuest(base).ok).toBe(true)
})
test('rejects unaccepted terms', () => {
  const r = validateGuest({ ...base, accepted_terms:false })
  expect(r.ok).toBe(false)
})
test('rejects bad email', () => {
  expect(validateGuest({ ...base, email:'nope' }).ok).toBe(false)
})

// Age boundaries and validation
test('age boundaries', () => {
  expect(validateGuest({ ...base, age:1 }).ok).toBe(true)
  expect(validateGuest({ ...base, age:120 }).ok).toBe(true)
  expect(validateGuest({ ...base, age:0 }).ok).toBe(false)
  expect(validateGuest({ ...base, age:121 }).ok).toBe(false)
  expect(validateGuest({ ...base, age:30.5 }).ok).toBe(false)
})

// Weight boundaries and validation
test('weight_kg boundaries', () => {
  expect(validateGuest({ ...base, weight_kg:20 }).ok).toBe(true)
  expect(validateGuest({ ...base, weight_kg:200 }).ok).toBe(true)
  expect(validateGuest({ ...base, weight_kg:19 }).ok).toBe(false)
  expect(validateGuest({ ...base, weight_kg:201 }).ok).toBe(false)
})

// Required fields: empty or whitespace
test('first_name required', () => {
  expect(validateGuest({ ...base, first_name:'' }).ok).toBe(false)
})
test('last_name required', () => {
  expect(validateGuest({ ...base, last_name:'  ' }).ok).toBe(false)
})
test('address required', () => {
  expect(validateGuest({ ...base, address:'' }).ok).toBe(false)
})
test('phone required', () => {
  expect(validateGuest({ ...base, phone:'' }).ok).toBe(false)
})

// Signature format validation
test('signature_png must be PNG data URI', () => {
  expect(validateGuest({ ...base, signature_png:'data:image/jpeg;base64,x' }).ok).toBe(false)
})
test('signature_png must be string', () => {
  expect(validateGuest({ ...base, signature_png:undefined }).ok).toBe(false)
  expect(validateGuest({ ...base, signature_png:null }).ok).toBe(false)
})
