import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { fillUrkundePdf, NAME_LINE, DATE_LINE } from '../src/server/urkundePdf'
import { pdfText } from './helpers/pdfText'

const templateBytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'Urkunde.pdf'))

// pdf-lib positions every drawText with `1 0 0 1 <x> <y> Tm` right before the
// string's `Tj`; pdfText decodes the string, so both can be read back together.
function placement(text: string, drawn: string): { x: number; y: number } {
  const escaped = drawn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = text.match(new RegExp(`1 0 0 1 ([\\d.]+) ([\\d.]+) Tm\\s+${escaped} Tj`))
  if (!m) throw new Error(`"${drawn}" not found on the page`)
  return { x: Number(m[1]), y: Number(m[2]) }
}

test('returns a one-page PDF', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Anna Muster', jumpDate: '2026-07-09' })

  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect((await PDFDocument.load(buf)).getPageCount()).toBe(1)
})

test('prints the date as DD.MM.YYYY', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Anna Muster', jumpDate: '2026-07-09' })

  expect(await pdfText(buf)).toContain('09.07.2026')
})

test('a name outside WinAnsi reaches the certificate as itself', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Ondřej Nováček', jumpDate: '2026-07-09' })

  expect(await pdfText(buf)).toContain('Ondřej Nováček')
})

test('the name sits just above the name line, centred on it', async () => {
  const name = 'Anna Muster'
  const buf = await fillUrkundePdf(templateBytes, { name, jumpDate: '2026-07-09' })
  const doc = await PDFDocument.load(buf)
  const { x, y } = placement(await pdfText(buf), name)

  expect(y).toBeGreaterThan(NAME_LINE.y)
  expect(y).toBeLessThan(NAME_LINE.y + 15)
  // Centred: equal space left and right of the text on the line.
  const width = await textWidth(doc, name, 'bold', 24)
  expect(x - NAME_LINE.x1).toBeCloseTo(NAME_LINE.x2 - (x + width), 1)
})

test('the date sits on the date line, centred on it', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Anna Muster', jumpDate: '2026-07-09' })
  const doc = await PDFDocument.load(buf)
  const { x, y } = placement(await pdfText(buf), '09.07.2026')

  expect(y).toBeGreaterThan(DATE_LINE.y)
  expect(y).toBeLessThan(DATE_LINE.y + 5)
  const width = await textWidth(doc, '09.07.2026', 'regular', 12)
  expect(x - DATE_LINE.x1).toBeCloseTo(DATE_LINE.x2 - (x + width), 1)
})

test('a very long name is shrunk to stay within the line', async () => {
  const name = 'Maximilian Alexander Konstantin von und zu Hohenberg-Schwarzenfeld'
  const buf = await fillUrkundePdf(templateBytes, { name, jumpDate: '2026-07-09' })
  const { x } = placement(await pdfText(buf), name)

  expect(x).toBeGreaterThanOrEqual(NAME_LINE.x1)
})

async function textWidth(
  doc: PDFDocument,
  text: string,
  weight: 'regular' | 'bold',
  size: number,
): Promise<number> {
  const { embedFont } = await import('../src/server/contractPdf')
  return (await embedFont(doc, weight)).widthOfTextAtSize(text, size)
}
