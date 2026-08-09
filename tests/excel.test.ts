import { test, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildWorkbook, DEFAULT_COLUMNS, EURO_FORMAT } from '../src/server/excel'

test('workbook has headers and a row, no signature column', async () => {
  const signature = 'data:image/png;base64,SECRETSIG'
  const rows = [{ first_name:'A', last_name:'B', age:30, signature_png: signature }]
  const buf = await buildWorkbook(rows, DEFAULT_COLUMNS)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values as string[]
  expect(headers).not.toContain('signature_png')
  expect(ws.getRow(2).getCell(1).value).toBe('A')

  const allValues: any[] = []
  ws.eachRow(row => allValues.push(row.values))
  const serialized = JSON.stringify(allValues)
  expect(serialized).not.toContain('data:image/png')
  expect(serialized).not.toContain(signature)
})

test('the totals block follows the rows after a blank spacer', async () => {
  const rows = [{ first_name: 'A' }, { first_name: 'B' }]
  const totals = [
    { label: 'Summe Bar', amount: 680 },
    { label: 'Gesamt', amount: 780 },
  ]
  const buf = await buildWorkbook(rows, DEFAULT_COLUMNS, [], totals)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]

  // header + 2 rows + blank = totals start on row 5
  expect(ws.getRow(4).getCell(1).value ?? '').toBe('')
  expect(ws.getRow(5).getCell(1).value).toBe('Summe Bar')
  expect(ws.getRow(5).getCell(2).value).toBe(680)
  expect(ws.getRow(6).getCell(1).value).toBe('Gesamt')
  expect(ws.getRow(6).getCell(2).value).toBe(780)
  // Kept a number with a currency format, not a pre-formatted string, so the
  // club can keep summing in Excel itself.
  expect(ws.getRow(6).getCell(2).numFmt).toBe(EURO_FORMAT)
})

test('a price cell stays a number and carries the euro format', async () => {
  const buf = await buildWorkbook([{ first_name: 'A', price: 410 }], DEFAULT_COLUMNS)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]
  const priceCol = (ws.getRow(1).values as any[]).indexOf('Preis')
  const cell = ws.getRow(2).getCell(priceCol)
  expect(cell.value).toBe(410)
  expect(cell.numFmt).toBe(EURO_FORMAT)
})

test('an empty price is left unformatted rather than rendered as 0 €', async () => {
  const buf = await buildWorkbook([{ first_name: 'A' }], DEFAULT_COLUMNS)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]
  const priceCol = (ws.getRow(1).values as any[]).indexOf('Preis')
  const cell = ws.getRow(2).getCell(priceCol)
  expect(cell.value ?? '').toBe('')
  expect(cell.numFmt).toBeUndefined()
})

test('the payout block follows the totals, one line per person', async () => {
  const rows = [{ first_name: 'A' }, { first_name: 'B' }]
  const totals = [{ label: 'Gesamt', amount: 780 }]
  const payouts = [
    {
      title: 'Vergütung Tandemmaster',
      entries: [
        { name: 'Seiberl Markus', calculation: '3 × 45,00 €', amount: 135 },
        { name: 'Gruber Hans', calculation: '1 × 45,00 €', amount: 45 },
      ],
      total: 180,
    },
    {
      title: 'Vergütung Videoflieger',
      entries: [{ name: 'Hofer Lisa', calculation: '1 × 60,00 € + 1 × 80,00 €', amount: 140 }],
      total: 140,
    },
  ]
  const buf = await buildWorkbook(rows, DEFAULT_COLUMNS, [], totals, payouts)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]

  // header + 2 rows + blank + 1 total + blank = the first title lands on row 7
  expect(ws.getRow(7).getCell(1).value).toBe('Vergütung Tandemmaster')
  expect(ws.getRow(7).getCell(1).font?.bold).toBe(true)
  expect(ws.getRow(8).getCell(1).value).toBe('Seiberl Markus')
  // The calculation sits beside the name so the amount can be checked without
  // counting the guest rows again.
  expect(ws.getRow(8).getCell(2).value).toBe('3 × 45,00 €')
  expect(ws.getRow(8).getCell(3).value).toBe(135)
  expect(ws.getRow(8).getCell(3).numFmt).toBe(EURO_FORMAT)
  expect(ws.getRow(9).getCell(1).value).toBe('Gruber Hans')
  expect(ws.getRow(10).getCell(1).value).toBe('Summe')
  expect(ws.getRow(10).getCell(3).value).toBe(180)
  expect(ws.getRow(10).getCell(3).font?.bold).toBe(true)

  expect(ws.getRow(12).getCell(1).value).toBe('Vergütung Videoflieger')
  expect(ws.getRow(13).getCell(2).value).toBe('1 × 60,00 € + 1 × 80,00 €')
  expect(ws.getRow(14).getCell(3).value).toBe(140)
})

test('the calculation column is wide enough not to be cut off', async () => {
  const payouts = [{
    title: 'Vergütung Videoflieger',
    entries: [{ name: 'Hofer Lisa', calculation: '1 × 60,00 € + 1 × 80,00 €', amount: 140 }],
    total: 140,
  }]
  const buf = await buildWorkbook([{ first_name: 'A' }], DEFAULT_COLUMNS, [], [], payouts)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]
  expect(ws.getColumn(2).width).toBeGreaterThanOrEqual(28)
  // The guest columns keep at least their old width.
  expect(ws.getColumn(1).width).toBeGreaterThanOrEqual(18)
  expect(ws.getColumn(4).width).toBe(18)
})

test('no payout block is written when nobody earned anything', async () => {
  const buf = await buildWorkbook([{ first_name: 'A' }], DEFAULT_COLUMNS, [], [], [])
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  expect(wb.worksheets[0].actualRowCount).toBe(2)
})

test('no totals block is written when there are no totals', async () => {
  const buf = await buildWorkbook([{ first_name: 'A' }], DEFAULT_COLUMNS)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  expect(wb.worksheets[0].actualRowCount).toBe(2)
})

test('the sheet carries the note in a column wide enough to read it', async () => {
  const note = 'Zuzahlung erlassen, Absprache mit dem Betriebsleiter'
  const buf = await buildWorkbook([{ first_name: 'A', notes: note }], DEFAULT_COLUMNS)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]

  const headers = (ws.getRow(1).values as string[]).filter(Boolean)
  expect(headers).toContain('Anmerkungen')
  const index = headers.indexOf('Anmerkungen') + 1
  expect(ws.getRow(2).getCell(index).value).toBe(note)
  // A note clipped to the uniform width would be a note nobody reads.
  expect(ws.getColumn(index).width).toBeGreaterThan(18)
})

test('a row without a note leaves a blank cell', async () => {
  const buf = await buildWorkbook([{ first_name: 'A', notes: null }], DEFAULT_COLUMNS)
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as any)
  const ws = wb.worksheets[0]
  const headers = (ws.getRow(1).values as string[]).filter(Boolean)
  const index = headers.indexOf('Anmerkungen') + 1
  expect(ws.getRow(2).getCell(index).value ?? '').toBe('')
})
