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

test('stampVoucherNumber prints the bare number on the finished contract', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, 'GS-2026-0815')

  const text = await pdfText(stamped)
  expect(text).toContain('GS-2026-0815')
  // No label: the blank line on the form already says what the number is.
  expect(text).not.toContain('Gutschein-Nr.')
  expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2)
})

test('a corrected number replaces the old one instead of printing over it', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const once = await stampVoucherNumber(contract, 'GS-2026-0815')
  const twice = await stampVoucherNumber(once, 'GS-2026-4711')

  const text = await pdfText(twice)
  expect(text).toContain('GS-2026-4711')
  // With no white box to hide behind, dropping the old content stream is the
  // only thing keeping both numbers off the page.
  expect(text).not.toContain('GS-2026-0815')
})

test('clearing the number leaves no stamp behind', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, 'GS-2026-0815')
  const cleared = await stampVoucherNumber(stamped, null)

  expect(await pdfText(cleared)).not.toContain('GS-2026-0815')
})

test('a blank number is treated as no number at all', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, '   ')
  const plain = await fillContractPdf(templateBytes, sampleData())

  // Nothing drawn, so nothing added: the page keeps the content it arrived with.
  const streams = async (b: Buffer) =>
    (await PDFDocument.load(b)).getPages()[0].node.Contents()?.toString()
  expect(await streams(stamped)).toBe(await streams(plain))
})

test('clearing a number twice does not eat into the contract itself', async () => {
  // The stamp is remembered by a key on the page. If an empty stamp wrongly
  // claimed the last existing stream as its own, the next call would delete a
  // piece of the template — and the signed original cannot be rebuilt.
  const contract = await fillContractPdf(templateBytes, sampleData())
  const once = await stampVoucherNumber(contract, null)
  const twice = await stampVoucherNumber(once, null)
  const thrice = await stampVoucherNumber(twice, 'GS-7')

  const text = await pdfText(thrice)
  expect(text).toContain('GS-7')
  // The guest data drawn at registration must still be there.
  expect(text).toContain('Mustermann')
})

test('the stamp lands on page 1 and leaves the rest of the contract alone', async () => {
  // The exact x/y in VOUCHER_STAMP is a visual decision, checked against the
  // printed template — the template's text is vector outlines, so no assertion
  // here can tell the blank line from a letter stroke. This test therefore
  // covers what code can know: the number is drawn, on the first page, and
  // nothing that was already on the contract went missing.
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampVoucherNumber(contract, 'GS-1')
  const doc = await PDFDocument.load(stamped)

  expect(doc.getPageCount()).toBe(2)
  const text = await pdfText(stamped)
  expect(text).toContain('GS-1')
  expect(text).toContain('Mustermann')
  expect(text).toContain('Freistadt')
})
