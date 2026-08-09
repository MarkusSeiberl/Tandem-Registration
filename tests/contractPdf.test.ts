import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { fillContractPdf, stampVoucherNumber } from '../src/server/contractPdf'

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

// ---------------------------------------------------------------------------
// The voucher number is stamped onto an already-signed contract, because the
// signature is not kept and the PDF therefore cannot be rebuilt from scratch.
// ---------------------------------------------------------------------------

// pdf-lib writes text as a Tj operator inside a Flate-compressed content stream,
// and encodes the string itself as hex (`<47757473…> Tj`). So the number is
// findable neither in the raw bytes nor in the decompressed stream — both layers
// have to come off before an assertion means anything.
async function pdfText(buf: Buffer): Promise<string> {
  const zlib = await import('zlib')
  const doc = await PDFDocument.load(buf)
  let out = ''
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const contents = (obj as any).contents
    if (!contents) continue
    const raw = Buffer.from(contents)
    try { out += zlib.inflateSync(raw).toString('latin1') } catch { out += raw.toString('latin1') }
  }
  return out.replace(/<([0-9A-Fa-f]+)>/g, (all, hex: string) =>
    hex.length % 2 === 0 ? Buffer.from(hex, 'hex').toString('latin1') : all)
}

test('the text extractor actually sees drawn text (guards the assertions below)', async () => {
  // Without this, every `not.toContain` case below would pass on a helper that
  // silently returns nothing useful.
  const contract = await fillContractPdf(templateBytes, sampleData())
  expect(await pdfText(await stampVoucherNumber(contract, 'PROBE-1'))).toContain('PROBE-1')
})

test('stampVoucherNumber prints the number on the finished contract', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, 'GS-2026-0815')

  expect(await pdfText(stamped)).toContain('Gutschein-Nr.: GS-2026-0815')
  expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2)
})

test('a corrected number replaces the old one instead of printing over it', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const once = await stampVoucherNumber(contract, 'GS-2026-0815')
  const twice = await stampVoucherNumber(once, 'GS-2026-4711')

  const text = await pdfText(twice)
  expect(text).toContain('Gutschein-Nr.: GS-2026-4711')
  // The white box under the new line is what makes this true on paper; here we
  // can at least prove the old number is no longer drawn.
  expect(text).not.toContain('GS-2026-0815')
})

test('clearing the number leaves no stamp behind', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, 'GS-2026-0815')
  const cleared = await stampVoucherNumber(stamped, null)

  expect(await pdfText(cleared)).not.toContain('Gutschein-Nr.')
})

test('a blank number is treated as no number at all', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, '   ')

  expect(await pdfText(stamped)).not.toContain('Gutschein-Nr.')
})

test('the stamp stays clear of the template header', async () => {
  // Measured, not assumed: the topmost ink in Befoerderungsvertrag.pdf sits at
  // y≈802. A stamp reaching into that would erase part of the club's header,
  // and the signed original cannot be regenerated.
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, 'GS-1')
  const page = (await PDFDocument.load(stamped)).getPages()[0]

  // The white box is drawn at y=814 with height 16 — entirely above the header
  // and entirely below the sheet edge.
  expect(page.getHeight()).toBeGreaterThan(814 + 16)
  expect(await pdfText(stamped)).toContain('Gutschein-Nr.: GS-1')
})
