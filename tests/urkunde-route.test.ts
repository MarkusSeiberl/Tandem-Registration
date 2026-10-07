import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'
import { pdfText } from './helpers/pdfText'
import { today } from '../src/server/day'

const validBody = () => ({
  first_name: 'Ondřej', last_name: 'Nováček', gender: 'male', age: 30,
  height_cm: 180, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  accepted_terms: true, privacy_ack: true,
})

test('serves the certificate with the guest name and jump date', async () => {
  const { app } = testServer()
  const create = await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })
  expect(create.statusCode).toBe(201)
  const { id } = create.json()

  const res = await app.inject({ method: 'GET', url: `/api/registrations/${id}/urkunde.pdf` })

  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toBe('application/pdf')
  expect(res.headers['content-disposition']).toBe('inline')
  const text = await pdfText(res.rawPayload)
  expect(text).toContain('Ondřej Nováček')
  expect(text).toContain(today().split('-').reverse().join('.'))
  await app.close()
})

test('404 for an unknown registration', async () => {
  const { app } = testServer()

  const res = await app.inject({ method: 'GET', url: '/api/registrations/999/urkunde.pdf' })

  expect(res.statusCode).toBe(404)
  await app.close()
})
