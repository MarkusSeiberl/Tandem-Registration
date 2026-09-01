import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { fillContractPdf, stampContract } from '../src/server/contractPdf'
import { pdfText } from './helpers/pdfText'

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

test('a minor guest gets the guardian caption under the signature', async () => {
  const buf = await fillContractPdf(templateBytes, { ...sampleData(), age: 17 })

  const text = await pdfText(buf)
  expect(text).toContain('gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre')
})

test('an adult contract carries no guardian caption', async () => {
  const buf = await fillContractPdf(templateBytes, sampleData())

  const text = await pdfText(buf)
  expect(text).not.toContain('gesetzlicher Vertreter')
})

// The club jumps 30 km from the Czech border, and the guests arrive from there,
// from Poland and from Turkey. Every one of those alphabets lives outside
// WinAnsi, which is all the PDF standard fonts can encode — a contract drawn
// with one of them throws on the first `ř`, and the throw happens inside the
// registration route before the row is written. The guest cannot register at
// all, and the tablet only says "Server-Fehler. Bitte erneut versuchen."
test('a guest whose name needs more than WinAnsi can register', async () => {
  const buf = await fillContractPdf(templateBytes, {
    ...sampleData(),
    firstName: 'Ondřej',
    lastName: 'Nováček',
    street: 'Hlavní třída 12',
    city: 'Český Krumlov',
  })

  const text = await pdfText(buf)
  // Not transliterated: the name on a Beförderungsvertrag is the guest's own.
  expect(text).toContain('Ondřej')
  expect(text).toContain('Nováček')
  expect(text).toContain('Český Krumlov')
})

test('Polish and Turkish letters reach the contract as themselves', async () => {
  const buf = await fillContractPdf(templateBytes, {
    ...sampleData(),
    firstName: 'Łukasz',
    lastName: 'Doğan',
    city: 'Gdańsk',
  })

  const text = await pdfText(buf)
  expect(text).toContain('Łukasz')
  expect(text).toContain('Doğan')
  expect(text).toContain('Gdańsk')
})

test('a Tandemmaster with a non-WinAnsi name is stamped, not swallowed', async () => {
  // The restamp is best-effort and logs its failures, so a throw here does not
  // fail an operator's save — it silently leaves the master off the contract.
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, {
    voucherNumber: 'GS-2026-0815',
    tandemMaster: 'Jiří Šťastný',
  })

  const text = await pdfText(stamped)
  expect(text).toContain('Jiří Šťastný')
  expect(text).toContain('GS-2026-0815')
})

// ---------------------------------------------------------------------------
// The voucher number is stamped onto an already-signed contract, because the
// signature is not kept and the PDF therefore cannot be rebuilt from scratch.
// ---------------------------------------------------------------------------

test('the text extractor actually sees drawn text (guards the assertions below)', async () => {
  // Without this, every `not.toContain` case below would pass on a helper that
  // silently returns nothing useful.
  const contract = await fillContractPdf(templateBytes, sampleData())
  expect(await pdfText(await stampContract(contract, { voucherNumber: 'PROBE-1', tandemMaster: null }))).toContain('PROBE-1')
})

test('stampContract prints the bare number on the finished contract', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, { voucherNumber: 'GS-2026-0815', tandemMaster: null })

  const text = await pdfText(stamped)
  expect(text).toContain('GS-2026-0815')
  // No label: the blank line on the form already says what the number is.
  expect(text).not.toContain('Gutschein-Nr.')
  expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2)
})

test('a corrected number replaces the old one instead of printing over it', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const once = await stampContract(contract, { voucherNumber: 'GS-2026-0815', tandemMaster: null })
  const twice = await stampContract(once, { voucherNumber: 'GS-2026-4711', tandemMaster: null })

  const text = await pdfText(twice)
  expect(text).toContain('GS-2026-4711')
  // With no white box to hide behind, dropping the old content stream is the
  // only thing keeping both numbers off the page.
  expect(text).not.toContain('GS-2026-0815')
})

test('clearing the number leaves no stamp behind', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, { voucherNumber: 'GS-2026-0815', tandemMaster: null })
  const cleared = await stampContract(stamped, { voucherNumber: null, tandemMaster: null })

  expect(await pdfText(cleared)).not.toContain('GS-2026-0815')
})

test('a blank number is treated as no number at all', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, { voucherNumber: '   ', tandemMaster: null })
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
  const once = await stampContract(contract, { voucherNumber: null, tandemMaster: null })
  const twice = await stampContract(once, { voucherNumber: null, tandemMaster: null })
  const thrice = await stampContract(twice, { voucherNumber: 'GS-7', tandemMaster: null })

  const text = await pdfText(thrice)
  expect(text).toContain('GS-7')
  // The guest data drawn at registration must still be there.
  expect(text).toContain('Mustermann')
})

test('the Tandemmaster is stamped onto the finished contract too', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, {
    voucherNumber: null, tandemMaster: 'Hans Gruber',
  })

  const text = await pdfText(stamped)
  expect(text).toContain('Hans Gruber')
  // Bare name, like the number: the club's own blank says what it is.
  expect(text).not.toContain('Tandemmaster')
  expect((await PDFDocument.load(stamped)).getPageCount()).toBe(2)
})

test('both stamped fields survive each other', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, {
    voucherNumber: 'GS-2026-0815', tandemMaster: 'Hans Gruber',
  })

  const text = await pdfText(stamped)
  expect(text).toContain('GS-2026-0815')
  expect(text).toContain('Hans Gruber')
})

test('a reassigned master replaces the old name instead of printing over it', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const once = await stampContract(contract, {
    voucherNumber: 'GS-1', tandemMaster: 'Hans Gruber',
  })
  const twice = await stampContract(once, {
    voucherNumber: 'GS-1', tandemMaster: 'Karl Berger',
  })

  const text = await pdfText(twice)
  expect(text).toContain('Karl Berger')
  expect(text).not.toContain('Hans Gruber')
  // One stream carries both, so re-stamping the master must redraw the number.
  expect(text).toContain('GS-1')
})

test('clearing the master leaves the voucher number alone', async () => {
  const contract = await fillContractPdf(templateBytes, sampleData())
  const once = await stampContract(contract, {
    voucherNumber: 'GS-1', tandemMaster: 'Hans Gruber',
  })
  const cleared = await stampContract(once, { voucherNumber: 'GS-1', tandemMaster: null })

  const text = await pdfText(cleared)
  expect(text).not.toContain('Hans Gruber')
  expect(text).toContain('GS-1')
})

test('the stamp lands on page 1 and leaves the rest of the contract alone', async () => {
  // The exact x/y in VOUCHER_STAMP and MASTER_STAMP is a visual decision, checked against the
  // printed template — the template's text is vector outlines, so no assertion
  // here can tell the blank line from a letter stroke. This test therefore
  // covers what code can know: the number is drawn, on the first page, and
  // nothing that was already on the contract went missing.
  const contract = await fillContractPdf(templateBytes, sampleData())
  const stamped = await stampContract(contract, {
    voucherNumber: 'GS-1', tandemMaster: 'Hans Gruber',
  })
  const doc = await PDFDocument.load(stamped)

  expect(doc.getPageCount()).toBe(2)
  const text = await pdfText(stamped)
  expect(text).toContain('GS-1')
  expect(text).toContain('Hans Gruber')
  expect(text).toContain('Mustermann')
  expect(text).toContain('Freistadt')
})
