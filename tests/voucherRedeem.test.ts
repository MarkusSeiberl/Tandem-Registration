import { test, expect, vi } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { redeemVoucher } from '../src/server/voucherRedeem'
import * as voucherList from '../src/server/voucherList'
import * as xlsxPatch from '../src/server/xlsxPatch'
import { clearVoucherListCache } from '../src/server/voucherList'
import { writeVoucherFile, writeVoucherSheets } from './helpers/voucherFile'
import { addForeignParts, changedParts, FOREIGN_PARTS, xlsxParts } from './helpers/xlsxParts'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'
import type { Config } from '../src/server/config'

// Only loadVoucherList is replaceable, and only so one test can hand the writer
// the stale row number a real 5-second-old parse would hand it after the club
// inserts a row in Excel. Everything else stays the real module.
vi.mock('../src/server/voucherList', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/voucherList')>()
  return { ...actual, loadVoucherList: vi.fn(actual.loadVoucherList) }
})

// Likewise for the writer: replaceable for exactly one test, the one that has to
// see the check refuse a workbook that came back short of a part.
vi.mock('../src/server/xlsxPatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server/xlsxPatch')>()
  return { ...actual, patchDateCell: vi.fn(actual.patchDateCell) }
})

const realPatchDateCell = vi.mocked(xlsxPatch.patchDateCell).getMockImplementation()!

async function configFor(voucherListPath: string): Promise<Config> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-redeem-'))
  return {
    exportDir: dir, contractText: '', privacyText: '', jumpLocation: '',
    backupDir: '', voucherListPath,
    prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
  }
}

async function cellValue(file: string, row: number, header: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values as string[]
  return ws.getRow(row).getCell(headers.indexOf(header)).value
}

// Extract value and format of a single cell for format-aware assertion
async function cellSnapshot(file: string, row: number, header: string): Promise<{ value: unknown; fmt: string | null }> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values as string[]
  const cell = ws.getRow(row).getCell(headers.indexOf(header))
  return {
    value: cell.value instanceof Date ? cell.value.toISOString() : (cell.value ?? null),
    fmt: cell.numFmt || null,
  }
}

// The whole sheet as comparable text, one entry per row and every column of it
// — including the trailing "Spalte1" the club's file carries. Each cell is
// recorded as both its value and its number format so style mutations that
// propagate via ExcelJS's shared style records do not go undetected.
async function sheetSnapshot(file: string): Promise<string[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const rows: string[] = []
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = []
    for (let c = 1; c <= ws.columnCount; c++) {
      const cell = row.getCell(c)
      const value = cell.value
      const fmt = cell.numFmt || null
      const cellData = {
        value: value instanceof Date ? value.toISOString() : (value ?? null),
        fmt: fmt,
      }
      cells.push(JSON.stringify(cellData))
    }
    rows.push(`${n}: ${cells.join(' | ')}`)
  })
  return rows
}

// Redemption dates are decided by the operator's local calendar, so the tests
// construct their days from local components — the same way a Date made at the
// till would be. A UTC-parsed '2026-08-10' would be the previous day west of
// Greenwich and make these assertions depend on where they run.
const AUG_10 = () => new Date(2026, 7, 10)

test('writes the redemption date into the Eingelöst cell', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('written')
  const written = await cellValue(file, 2, 'Eingelöst')
  expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
})

test('a date already in the cell is left exactly as it is', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    {
      lfdNr: '26-002', einzahlDat: new Date('2026-01-14'), art: 'Tandem',
      eingeloest: new Date('2026-07-12'),
    },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-002', AUG_10())).toBe('already_redeemed')
  const kept = await cellValue(file, 2, 'Eingelöst')
  expect(kept instanceof Date && kept.toISOString().slice(0, 10)).toBe('2026-07-12')
})

test('an invalid voucher is never marked as redeemed', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-007', AUG_10())).toBe('invalid')
  expect(await redeemVoucher(cfg, '26-009', AUG_10())).toBe('invalid')
  expect(await cellValue(file, 2, 'Eingelöst')).toBeNull()
  expect(await cellValue(file, 3, 'Eingelöst')).toBeNull()
})

test('a number the list does not carry is unknown, not invalid', async () => {
  // 'invalid' is the list actively saying no — unpaid, cancelled — and the
  // export sweep answers it by taking the redemption back. A number the list
  // has never heard of says nothing about the voucher, and erasing a
  // redemption over it is how a whole season's redemptions were lost while
  // only the first sheet was being read.
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '99-999', AUG_10())).toBe('unknown')
  expect(await cellValue(file, 2, 'Eingelöst')).toBeNull()
})

test('a number on two sheets is unknown rather than written to a guessed row', async () => {
  clearVoucherListCache()
  const file = await writeVoucherSheets([
    { name: '2026', rows: [{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' }] },
    { name: '2026 - Part 2', rows: [{ lfdNr: '26-001', einzahlDat: new Date('2026-06-01'), art: 'Tandem' }] },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('unknown')
})

test('a voucher on a later sheet is written to that sheet', async () => {
  clearVoucherListCache()
  const file = await writeVoucherSheets([
    { name: '2025', rows: [{ lfdNr: '25-001', einzahlDat: new Date('2025-01-14'), art: 'Tandem' }] },
    { name: '2026', rows: [{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' }] },
    { name: '2026 - Part 2', rows: [{ lfdNr: '26-500', einzahlDat: new Date('2026-06-01'), art: 'Tandem' }] },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-500', AUG_10())).toBe('written')

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const written = wb.getWorksheet('2026 - Part 2')!.getRow(2).getCell(8).value
  expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
  // The sheets it was not asked about keep their empty cells.
  expect(wb.getWorksheet('2025')!.getRow(2).getCell(8).value).toBeNull()
  expect(wb.getWorksheet('2026')!.getRow(2).getCell(8).value).toBeNull()
})

test("everything in the club's file except the one cell survives the write", async () => {
  // The corruption this whole writer exists to prevent. Reading the workbook
  // into ExcelJS and writing it back rebuilds every part and drops the ones it
  // cannot model — a chart, a table, a formula cache — and Excel then opens the
  // club's list with "unreadable content" and repairs it.
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  await addForeignParts(file)
  const cfg = await configFor(file)
  const before = await fs.readFile(file)

  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('written')

  const after = await fs.readFile(file)
  const changed = await changedParts(before, after)
  expect(changed.filter((name) => !name.startsWith('xl/worksheets/'))).toEqual(['xl/styles.xml'])
  const parts = await xlsxParts(after)
  for (const name of FOREIGN_PARTS) expect([...parts.keys()]).toContain(name)
})

test('the list is backed up once a day, not once per write', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  await redeemVoucher(cfg, '26-001', AUG_10())
  await redeemVoucher(cfg, '26-002', AUG_10())

  const backups = await fs.readdir(path.join(cfg.exportDir, 'Gutschein-Backup'))
  expect(backups).toEqual(['Tandemliste_2026-08-10.xlsx'])
})

test('an unreadable list is a technical failure, to be retried', async () => {
  clearVoucherListCache()
  const cfg = await configFor('C:/nope/keine-datei.xlsx')
  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('failed')
})

test('no configured list means nothing to do', async () => {
  const cfg = await configFor('')
  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('disabled')
})

test('the write changes the redeemed cell and nothing else in the sheet', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem', betrag: 270 },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15'), art: 'Tandem + Video', betrag: 350 },
  ])
  const cfg = await configFor(file)

  const before = await sheetSnapshot(file)
  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('written')
  const after = await sheetSnapshot(file)
  const afterEingeloest = await cellSnapshot(file, 2, 'Eingelöst')

  // Row 2 is the one that was redeemed; every other row — header, neighbour —
  // has to come back byte-for-byte identical, trailing "Spalte1" included.
  const untouched = (rows: string[]) => rows.filter((r) => !r.startsWith('2: '))
  expect(untouched(after)).toEqual(untouched(before))
  expect(before[0]).toContain('"Spalte1"')
  // …and within the redeemed row, only the Eingelöst cell's value moved. Its
  // format must never be the explicitly-assigned 'dd.mm.yyyy' that would
  // propagate via ExcelJS's shared records and restyle unrelated date cells.
  expect(afterEingeloest.fmt).not.toBe('dd.mm.yyyy')
  expect(afterEingeloest.value).toMatch(/^2026-08-10T/)
  expect(await cellValue(file, 2, 'LfdNr')).toBe('26-001')
  expect(await cellValue(file, 2, 'Betrag')).toBe(270)
  expect(await cellValue(file, 2, 'Art')).toBe('Tandem')
})

test('a redemption just after local midnight is dated that local day', async () => {
  clearVoucherListCache()
  // Pinned east of Greenwich on purpose: `new Date(2026, 7, 10, 0, 30)` is
  // already 10 August in UTC, so under TZ=UTC (typical in CI) this test would
  // pass even with the old `toISOString`-based day restored. Vienna is where
  // the club actually is, and it is the timezone this bug depends on.
  vi.stubEnv('TZ', 'Europe/Vienna')
  try {
    const file = await writeVoucherFile([
      { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    ])
    const cfg = await configFor(file)

    // 00:30 on 10 August as the club's clock shows it. East of Greenwich that
    // instant is still 9 August in UTC, and a UTC-derived day would write the
    // wrong date into the club's list and reuse yesterday's backup name.
    expect(await redeemVoucher(cfg, '26-001', new Date(2026, 7, 10, 0, 30))).toBe('written')
    const written = await cellValue(file, 2, 'Eingelöst')
    expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
    const backups = await fs.readdir(path.join(cfg.exportDir, 'Gutschein-Backup'))
    expect(backups).toEqual(['Tandemliste_2026-08-10.xlsx'])
  } finally {
    vi.unstubAllEnvs()
  }
})

test('a stale row number is not written to when that row holds another voucher', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  const list = await voucherList.loadVoucherList(file)
  const entry = list.byNumber.get('26-1')![0]
  // What the club inserting a row in Excel does to a parse taken up to five
  // seconds earlier: the remembered row number now addresses 26-002.
  vi.mocked(voucherList.loadVoucherList).mockResolvedValueOnce({
    ...list,
    byNumber: new Map([['26-1', [{ ...entry, rowNumber: entry.rowNumber + 1 }]]]),
  })

  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('failed')
  // Neither the row it aimed at nor the right one may carry a date now.
  expect(await cellValue(file, 2, 'Eingelöst')).toBeNull()
  expect(await cellValue(file, 3, 'Eingelöst')).toBeNull()
})

test('concurrent redemptions all reach the file and none overwrites another', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15'), art: 'Tandem' },
    { lfdNr: '26-003', einzahlDat: new Date('2026-01-16'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  // Started together, the way two tills and the export sweep can hit this.
  // Without a queue each call reads the workbook before the others write, and
  // the last writer's copy — missing the other two dates — wins.
  const outcomes = await Promise.all([
    redeemVoucher(cfg, '26-001', AUG_10()),
    redeemVoucher(cfg, '26-002', AUG_10()),
    redeemVoucher(cfg, '26-003', AUG_10()),
  ])
  expect(outcomes).toEqual(['written', 'written', 'written'])
  for (const row of [2, 3, 4]) {
    const written = await cellValue(file, row, 'Eingelöst')
    expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
  }
})

test('a failed call does not block the one queued behind it', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  vi.mocked(voucherList.loadVoucherList).mockRejectedValueOnce(new Error('boom'))
  const failed = redeemVoucher(cfg, '26-001', AUG_10())
  const next = redeemVoucher(cfg, '26-001', AUG_10())
  expect(await failed).toBe('failed')
  expect(await next).toBe('written')
})

test("the club's list is still complete at the moment the new one replaces it", async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)
  const before = await sheetSnapshot(file)

  // The only observable moment of the swap. ExcelJS's writeFile would have
  // truncated the club's list at the start of the serialisation and left it
  // partial until the last byte; here the old file must still parse as a whole
  // workbook when the finished new one is about to take its place.
  let intactAtSwap: string[] | null = null
  const realRename = fs.rename
  const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === file) intactAtSwap = await sheetSnapshot(file)
    return realRename(from, to)
  })

  try {
    expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('written')
  } finally {
    rename.mockRestore()
  }
  expect(intactAtSwap).toEqual(before)
})

test('the dated backup only appears under its real name once it is complete', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)
  const target = path.join(cfg.exportDir, 'Gutschein-Backup', 'Tandemliste_2026-08-10.xlsx')

  // Creating the dated name with 'wx' made it exist empty first; a process
  // killed in that window left the name taken forever and every later write
  // that day found it and skipped backing up. So nothing may exist under that
  // name until the bytes are already there.
  let existedBeforeSwap: boolean | null = null
  let bytesAtSwap = 0
  const realRename = fs.rename
  const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === target) {
      existedBeforeSwap = await fs.stat(target).then(() => true, () => false)
      bytesAtSwap = (await fs.stat(from)).size
    }
    return realRename(from, to)
  })

  try {
    expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('written')
  } finally {
    rename.mockRestore()
  }
  expect(existedBeforeSwap).toBe(false)
  expect(bytesAtSwap).toBeGreaterThan(0)
  expect(await fs.readdir(path.dirname(target))).toEqual(['Tandemliste_2026-08-10.xlsx'])
})

test('a written list is left openable, with no temp file beside it', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('written')
  // The workbook is serialised into a sibling and renamed over the target, so
  // the club's folder must hold the list and nothing else afterwards.
  expect(await fs.readdir(path.dirname(file))).toEqual(['Tandemliste.xlsx'])
  const wb = new ExcelJS.Workbook()
  await expect(wb.xlsx.readFile(file)).resolves.toBeDefined()
})

test('a write that would lose a part of the file never reaches the disk', async () => {
  // The last line of defence. Whatever goes wrong inside the writer, the club's
  // folder must never end up holding a workbook that lost a part — the operator
  // gets a retryable 'failed' and the list that was already there.
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  await addForeignParts(file)
  const cfg = await configFor(file)
  const before = await fs.readFile(file)

  // Stands in for anything that could go wrong inside the writer: the patched
  // workbook comes back one part short.
  vi.mocked(xlsxPatch.patchDateCell).mockImplementationOnce(async (source, target) => {
    const zip = await JSZip.loadAsync(await realPatchDateCell(source, target))
    zip.remove('xl/charts/chart1.xml')
    return zip.generateAsync({ type: 'nodebuffer' })
  })

  expect(await redeemVoucher(cfg, '26-001', AUG_10())).toBe('failed')

  expect((await fs.readFile(file)).equals(before)).toBe(true)
  expect(await fs.readdir(path.dirname(file))).toEqual(['Tandemliste.xlsx'])
})
