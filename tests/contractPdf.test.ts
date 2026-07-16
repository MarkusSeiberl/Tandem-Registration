import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { fillContractPdf } from '../src/server/contractPdf'

const templateBytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'Befoerderungsvertrag.pdf'))

// Smallest possible valid PNG (1x1 px), used only so pdf-lib's embedPng has
// real image bytes to decode — the actual look of the signature doesn't matter here.
const SIGNATURE_PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const sampleData = () => ({
  firstName: 'Max', lastName: 'Mustermann',
  street: 'Musterstraße 1', postalCode: '4240', city: 'Freistadt',
  phone: '0660123456', email: 'max@example.at',
  age: 30, heightCm: 182, weightKg: 85,
  ort: 'Freistadt', datum: '16.07.2026',
  signaturePngDataUrl: SIGNATURE_PNG_1X1,
})

test('fillContractPdf returns a real two-page PDF', async () => {
  const buf = await fillContractPdf(templateBytes, sampleData())

  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  const doc = await PDFDocument.load(buf)
  expect(doc.getPageCount()).toBe(2)
})

test('fillContractPdf output is larger than the bare template (text + image were added)', async () => {
  const buf = await fillContractPdf(templateBytes, sampleData())
  expect(buf.length).toBeGreaterThan(templateBytes.length)
})
