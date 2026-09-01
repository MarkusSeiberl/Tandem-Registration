import { test, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { patchDateCell } from '../src/server/xlsxPatch'
import { changedParts, FOREIGN_PARTS, workbookWithForeignParts, xlsxParts } from './helpers/xlsxParts'

const AUG_10 = new Date(Date.UTC(2026, 7, 10))

// Header row, one open voucher and one the club redeemed by hand. That last row
// is what makes this the club's shape rather than a fresh sheet: the Eingelöst
// column already carries a date format, so a write into it needs no new style.
const twoVouchers = (sheet: ExcelJS.Worksheet) => {
  sheet.addRow(['LfdNr', 'Betrag', 'Eingelöst'])
  sheet.addRow(['26-001', 270, null])
  sheet.addRow(['26-002', 350, new Date(Date.UTC(2026, 6, 12))])
}

async function cell(buffer: Buffer, sheetName: string, row: number, column: number) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  return wb.getWorksheet(sheetName)!.getRow(row).getCell(column)
}

async function sheetXml(buffer: Buffer, part: string): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  return zip.file(part)!.async('string')
}

test('the date arrives in the cell it was aimed at', async () => {
  const before = await workbookWithForeignParts(twoVouchers)

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  const written = (await cell(after, 'Tabelle1', 2, 3)).value
  expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
})

test('every other part of the workbook comes back byte-for-byte', async () => {
  // The whole reason this writer exists. Reading the workbook into a model and
  // writing a new one back rebuilds every part — and drops the ones the model
  // has no room for, which is what left the club's file needing repair.
  const before = await workbookWithForeignParts(twoVouchers)

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  expect(await changedParts(before, after)).toEqual(['xl/worksheets/sheet1.xml'])
})

test('parts ExcelJS cannot model survive the write', async () => {
  // Stated separately from the diff above, because this is the failure the club
  // actually saw: a chart, a table and a formula cache that a rewrite deletes.
  const before = await workbookWithForeignParts(twoVouchers)

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  const parts = await xlsxParts(after)
  for (const name of FOREIGN_PARTS) expect([...parts.keys()]).toContain(name)
})

test('the sheet is chosen by name, not by being the first one', async () => {
  const before = await workbookWithForeignParts(twoVouchers, {
    sheetNames: ['2025', '2026', '2026 - Part 2'],
  })

  const after = await patchDateCell(before, {
    sheetName: '2026 - Part 2', row: 2, column: 3, date: AUG_10,
  })

  expect((await cell(after, '2026 - Part 2', 2, 3)).value).toBeInstanceOf(Date)
  expect((await cell(after, '2025', 2, 3)).value).toBeNull()
  expect((await cell(after, '2026', 2, 3)).value).toBeNull()
  expect(await changedParts(before, after)).toEqual(['xl/worksheets/sheet3.xml'])
})

test('a cell the row does not have yet is inserted in column order', async () => {
  // A club that never filled this column has rows that stop before it: there is
  // no <c> to put a value in, and one appended after the last cell would leave
  // the row's cells out of column order, which Excel reads as damage.
  const before = await workbookWithForeignParts((sheet) => {
    sheet.addRow(['LfdNr', 'Betrag', 'Eingelöst', 'E-Mail'])
    sheet.addRow(['26-001', 270, null, 'a@b.c'])
  })

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  const xml = await sheetXml(after, 'xl/worksheets/sheet1.xml')
  const row2 = xml.slice(xml.indexOf('<row r="2"'), xml.indexOf('</row>', xml.indexOf('<row r="2"')))
  expect([...row2.matchAll(/<c r="([A-Z]+)2"/g)].map((m) => m[1])).toEqual(['A', 'B', 'C', 'D'])
  expect((await cell(after, 'Tabelle1', 2, 3)).value).toBeInstanceOf(Date)
})

test('a row the sheet does not have yet is inserted in row order', async () => {
  const before = await workbookWithForeignParts(twoVouchers)

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })
  const withGapFilled = await patchDateCell(after, {
    sheetName: 'Tabelle1', row: 5, column: 3, date: AUG_10,
  })

  const xml = await sheetXml(withGapFilled, 'xl/worksheets/sheet1.xml')
  expect([...xml.matchAll(/<row r="(\d+)"/g)].map((m) => m[1])).toEqual(['1', '2', '3', '5'])
  expect((await cell(withGapFilled, 'Tabelle1', 5, 3)).value).toBeInstanceOf(Date)
})

test('a column with no date format of its own gets one', async () => {
  // A club that has never filled this column in leaves it formatted as General,
  // and a serial number written into General reads as 46244, not 10.08.2026.
  const before = await workbookWithForeignParts((sheet) => {
    sheet.addRow(['LfdNr', 'Betrag', 'Eingelöst'])
    sheet.addRow(['26-001', 270, null])
  })

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  expect((await cell(after, 'Tabelle1', 2, 3)).numFmt).toBeTruthy()
  // The format is appended to the style table. Appending cannot renumber what
  // is already there, so no other cell in the workbook changes appearance.
  expect(await changedParts(before, after))
    .toEqual(['xl/styles.xml', 'xl/worksheets/sheet1.xml'])
})

test('a format the column already carries is used as it stands', async () => {
  // Adding a second, near-identical format would leave the club's column
  // looking subtly different row by row.
  const before = await workbookWithForeignParts(twoVouchers)
  const styledRows = await xlsxParts(before)

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  expect(styledRows.get('xl/styles.xml')!.equals((await xlsxParts(after)).get('xl/styles.xml')!))
    .toBe(true)
  const written = await cell(after, 'Tabelle1', 2, 3)
  expect(written.numFmt).toBe((await cell(before, 'Tabelle1', 3, 3)).numFmt)
})

test('the sheet dimension grows to cover a cell outside it', async () => {
  const before = await workbookWithForeignParts((sheet) => {
    sheet.addRow(['LfdNr'])
    sheet.addRow(['26-001'])
  })

  const after = await patchDateCell(before, {
    sheetName: 'Tabelle1', row: 2, column: 3, date: AUG_10,
  })

  const xml = await sheetXml(after, 'xl/worksheets/sheet1.xml')
  expect(xml).toContain('<dimension ref="A1:C2"/>')
})

test('a sheet name the workbook does not have is refused', async () => {
  const before = await workbookWithForeignParts(twoVouchers)

  await expect(patchDateCell(before, {
    sheetName: 'Tabelle2', row: 2, column: 3, date: AUG_10,
  })).rejects.toThrow('Tabelle2')
})
