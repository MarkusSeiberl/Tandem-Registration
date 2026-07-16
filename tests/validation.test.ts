import { test, expect } from 'vitest'
import { validateGuest } from '../src/server/validation'

const base = { first_name:'A', last_name:'B', gender:'female', age:30,
  height_cm:170, weight_kg:80,
  street:'X 1', postal_code:'4240', city:'Freistadt',
  email:'a@b.de', phone:'0660', signature_png:'data:image/png;base64,x',
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

// Height boundaries and validation
test('height_cm boundaries', () => {
  expect(validateGuest({ ...base, height_cm:100 }).ok).toBe(true)
  expect(validateGuest({ ...base, height_cm:220 }).ok).toBe(true)
  expect(validateGuest({ ...base, height_cm:99 }).ok).toBe(false)
  expect(validateGuest({ ...base, height_cm:221 }).ok).toBe(false)
  expect(validateGuest({ ...base, height_cm:170.5 }).ok).toBe(false)
})

// Gender is a closed enum
test('gender must be one of the known values', () => {
  expect(validateGuest({ ...base, gender:'male' }).ok).toBe(true)
  expect(validateGuest({ ...base, gender:'female' }).ok).toBe(true)
  expect(validateGuest({ ...base, gender:'diverse' }).ok).toBe(true)
  expect(validateGuest({ ...base, gender:'weiblich' }).ok).toBe(false)
  expect(validateGuest({ ...base, gender:'' }).ok).toBe(false)
  expect(validateGuest({ ...base, gender:undefined }).ok).toBe(false)
})

// Required fields: empty or whitespace
test('first_name required', () => {
  expect(validateGuest({ ...base, first_name:'' }).ok).toBe(false)
})
test('last_name required', () => {
  expect(validateGuest({ ...base, last_name:'  ' }).ok).toBe(false)
})
test('street required', () => {
  expect(validateGuest({ ...base, street:'' }).ok).toBe(false)
})
test('postal_code required', () => {
  expect(validateGuest({ ...base, postal_code:'' }).ok).toBe(false)
  expect(validateGuest({ ...base, postal_code:'  ' }).ok).toBe(false)
})
test('city required', () => {
  expect(validateGuest({ ...base, city:'' }).ok).toBe(false)
})
test('phone required', () => {
  expect(validateGuest({ ...base, phone:'' }).ok).toBe(false)
})

// Presence check only — foreign guests bring 5-digit (DE) or alphanumeric (UK)
// postal codes, so no digit-count rule may be applied.
test('postal_code accepts non-Austrian formats', () => {
  expect(validateGuest({ ...base, postal_code:'10115' }).ok).toBe(true)
  expect(validateGuest({ ...base, postal_code:'SW1A 1AA' }).ok).toBe(true)
})

// Signature format validation
test('signature_png must be PNG data URI', () => {
  expect(validateGuest({ ...base, signature_png:'data:image/jpeg;base64,x' }).ok).toBe(false)
})
test('signature_png must be string', () => {
  expect(validateGuest({ ...base, signature_png:undefined }).ok).toBe(false)
  expect(validateGuest({ ...base, signature_png:null }).ok).toBe(false)
})
