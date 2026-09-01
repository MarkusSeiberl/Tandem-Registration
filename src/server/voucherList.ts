import type { VoucherService } from './pricing'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'

// The club writes a voucher number as "26-001": a year prefix, a separator and
// a zero-padded counter. What the manifest types is whatever the guest's paper
// says, so both sides are reduced to the same shape before they are compared.
//
// The groups are re-joined with a single '-' rather than concatenated, so a
// separator stays meaningful: "26001" is a different voucher from "26-001".
export function normaliseVoucherNumber(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .split(/[^0-9A-Z]+/)
    .filter((part) => part.length > 0)
    // Leading zeros are padding, not value — but a group of only zeros keeps one.
    .map((part) => part.replace(/^0+(?=[0-9A-Z])/, ''))
    .join('-')
}

// `Art` is free text the club types, so it is read by keyword rather than
// matched against a list of exact spellings.
//
// Without "Tandem" the entry covers no jump: the sample list holds
// "Video + Foto zu GS25-2", an add-on bought on top of another voucher. Mapping
// that to jump_video_photo would hand the guest a jump that was never paid for,
// so it is reported as an add-on and compared against nothing.
export function serviceFromArt(
  art: string | null
): { service: VoucherService | null; isAddOn: boolean } {
  const text = (art ?? '').toLowerCase()
  const hasVideo = text.includes('video')
  const hasPhoto = text.includes('foto') || text.includes('photo')
  if (!text.includes('tandem')) return { service: null, isAddOn: hasVideo || hasPhoto }
  if (hasVideo && hasPhoto) return { service: 'jump_video_photo', isAddOn: false }
  if (hasVideo) return { service: 'jump_video', isAddOn: false }
  return { service: 'jump', isAddOn: false }
}

export interface VoucherEntry {
  /** As written in the sheet, for display. */
  number: string
  /** Tab name of the sheet this row is on — with a sheet per season, a row number alone addresses nothing. */
  sheetName: string
  /** 1-based sheet row, so the redemption can be written back to it. */
  rowNumber: number
  paidAt: Date | null
  /** Set when EinzahlDat holds text instead of a date, e.g. "STORNO". */
  paidText: string | null
  amount: number | null
  art: string | null
  service: VoucherService | null
  isAddOn: boolean
  redeemedAt: Date | null
}

export interface VoucherList {
  /** Every sheet the vouchers were read from, in workbook order. */
  sheetNames: string[]
  /** Normalised number -> every row carrying it. More than one means ambiguous. */
  byNumber: Map<string, VoucherEntry[]>
}

const REQUIRED_HEADERS = ['lfdnr', 'einzahldat', 'eingelöst'] as const

// The club's sheet already carries a stray "Spalte1"; anyone inserting a column
// must not silently shift the reader onto the wrong data, so columns are located
// by their header text rather than by position.
//
// Exported because the redemption writer has to find the same columns in the
// same file. A second, near-identical lookup there drifted once already: it
// skipped unwrapCellValue, so a hyperlinked header cell would have been found
// here and missed there — the reader and the writer would have disagreed about
// which column is which in the club's only voucher record.
export function headerColumns(sheet: ExcelJS.Worksheet): Map<string, number> {
  const columns = new Map<string, number>()
  const header = sheet.getRow(1)
  for (let c = 1; c <= sheet.columnCount; c++) {
    const raw = unwrapCellValue(header.getCell(c).value)
    if (raw === null || raw === undefined) continue
    const key = String(raw)
      .trim()
      .toLowerCase()
      // The club's file spells it "Eingelöst"; tolerate an ASCII rewrite too.
      .replace('eingeloest', 'eingelöst')
    if (key.length > 0 && !columns.has(key)) columns.set(key, c)
  }
  return columns
}

// ExcelJS hands back a hyperlink cell as { text, hyperlink } instead of a plain
// scalar. Every cell reader — header or data — routes through this so a
// hyperlinked column can't silently stringify to "[object Object]" in one path
// while working in another. Only that `text` shape is unwrapped: a rich-text
// cell is { richText: [...] } and passes through untouched, so a cell the club
// formatted word by word is not read here either.
function unwrapCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (value !== null && typeof value === 'object' && 'text' in value) {
    return (value as { text: ExcelJS.CellValue }).text
  }
  return value
}

function cellDate(value: ExcelJS.CellValue): { date: Date | null; text: string | null } {
  const unwrapped = unwrapCellValue(value)
  if (unwrapped instanceof Date) return { date: unwrapped, text: null }
  if (unwrapped === null || unwrapped === undefined) return { date: null, text: null }
  const text = String(unwrapped).trim()
  return { date: null, text: text.length > 0 ? text : null }
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  const unwrapped = unwrapCellValue(value)
  return typeof unwrapped === 'number' && Number.isFinite(unwrapped) ? unwrapped : null
}

// Exported alongside headerColumns so the redemption writer reads a cell the
// same way this reader did — a row is only identified as the right one if both
// sides turn its LfdNr into the same text.
export function cellText(value: ExcelJS.CellValue): string | null {
  const unwrapped = unwrapCellValue(value)
  if (unwrapped === null || unwrapped === undefined) return null
  const text = String(unwrapped).trim()
  return text.length > 0 ? text : null
}

export async function readVoucherList(filePath: string): Promise<VoucherList> {
  const wb = new ExcelJS.Workbook()
  try {
    await wb.xlsx.readFile(filePath)
  } catch {
    // ExcelJS throws its own English "File not found" error here, but this
    // module is called from a route that shows the message straight to the
    // club's operator, so it has to be German.
    throw new Error(`Die Gutscheinliste konnte nicht gelesen werden: ${filePath}`)
  }
  if (wb.worksheets.length === 0) {
    throw new Error('Die Gutscheinliste enthält kein Tabellenblatt.')
  }

  // The club runs a sheet per season — "2025", "2026", "2026 - Part 2" — and
  // keeps price lists and address tables in the same workbook. So every sheet
  // is offered, and the ones carrying the voucher columns are the list; a sheet
  // without them is somebody else's table, not a broken voucher sheet.
  const sheets = wb.worksheets
    .map((sheet) => ({ sheet, columns: headerColumns(sheet) }))
    .filter(({ columns }) => REQUIRED_HEADERS.every((h) => columns.has(h)))

  if (sheets.length === 0) {
    // Nothing in the workbook is a voucher sheet. The operator is told what a
    // voucher sheet would need, measured against the first sheet — with no
    // candidate to name, that is the one they are most likely looking at.
    const columns = headerColumns(wb.worksheets[0])
    const missing = REQUIRED_HEADERS.filter((h) => !columns.has(h))
    const names = missing.map((m) => (m === 'eingelöst' ? 'Eingelöst' : m === 'lfdnr' ? 'LfdNr' : 'EinzahlDat'))
    // The operator reads this message as it stands, so it has to agree in
    // number: "fehlt die Spalte LfdNr, Eingelöst" is not German.
    throw new Error(names.length === 1
      ? `In der Gutscheinliste fehlt die Spalte ${names[0]}.`
      : `In der Gutscheinliste fehlen die Spalten ${names.join(', ')}.`)
  }

  const byNumber = new Map<string, VoucherEntry[]>()

  for (const { sheet, columns } of sheets) {
    const at = (row: ExcelJS.Row, key: string) => {
      const index = columns.get(key)
      return index === undefined ? null : row.getCell(index).value
    }

    // eachRow visits only the rows that exist and hands each one its true 1-based
    // sheet row number, skipping the gaps a club's list collects over the years.
    // Counting the rows we happened to see would drift past the first gap, and
    // the number stored here is what the redemption writer addresses when it puts
    // a date back into this voucher's row.
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return

      const number = cellText(at(row, 'lfdnr'))
      // A blank number is a spacer or a half-typed row, not a voucher.
      if (!number) return

      const paid = cellDate(at(row, 'einzahldat'))
      const art = cellText(at(row, 'art'))
      const { service, isAddOn } = serviceFromArt(art)
      const entry: VoucherEntry = {
        number,
        sheetName: sheet.name,
        rowNumber,
        paidAt: paid.date,
        paidText: paid.text,
        amount: cellNumber(at(row, 'betrag')),
        art,
        service,
        isAddOn,
        redeemedAt: cellDate(at(row, 'eingelöst')).date,
      }
      // Collected across sheets, so a number carried onto a second season is
      // ambiguous rather than resolved by whichever sheet came first.
      const key = normaliseVoucherNumber(number)
      const existing = byNumber.get(key)
      if (existing) existing.push(entry)
      else byNumber.set(key, [entry])
    })
  }

  return { sheetNames: sheets.map(({ sheet }) => sheet.name), byNumber }
}

export type VoucherStatus =
  | 'ok'
  | 'not_found'
  | 'ambiguous'
  | 'unpaid'
  | 'cancelled'
  | 'redeemed'

export interface VoucherLookup {
  status: VoucherStatus
  /** Null when nothing could be identified — not found, or more than one match. */
  entry: VoucherEntry | null
}

export function lookupVoucher(list: VoucherList, raw: string): VoucherLookup {
  const key = normaliseVoucherNumber(raw)
  if (key.length === 0) return { status: 'not_found', entry: null }

  const matches = list.byNumber.get(key)
  if (!matches || matches.length === 0) return { status: 'not_found', entry: null }
  // Picking one of two would be a guess about the club's money.
  if (matches.length > 1) return { status: 'ambiguous', entry: null }

  const entry = matches[0]
  if (entry.paidText !== null) return { status: 'cancelled', entry }
  if (entry.paidAt === null) return { status: 'unpaid', entry }
  if (entry.redeemedAt !== null) return { status: 'redeemed', entry }
  return { status: 'ok', entry }
}

// Parsing the workbook costs real time and the manifest asks after every pause
// in typing. The cache is keyed on what a changed file changes — path, mtime and
// size — so an edit the club makes mid-day still arrives without a restart.
let cache: { path: string; mtimeMs: number; size: number; cachedAt: number; list: VoucherList } | null = null

// mtime+size is the primary freshness signal, but an in-place edit that lands
// within the same timestamp tick and keeps the byte count unchanged is
// invisible to it — the cache would then serve a stale redemption answer
// forever. This ceiling is the backstop for exactly that blind spot: long
// enough that a burst of keystroke-driven checks still costs one parse, short
// enough that a stale answer can't survive a jump-day conversation with a guest.
const MAX_CACHE_AGE_MS = 5000

export function clearVoucherListCache(): void {
  cache = null
}

export async function loadVoucherList(filePath: string): Promise<VoucherList> {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    // fs.stat throws Node's raw English ENOENT/EACCES; readVoucherList fails
    // on the same file for the same reason and produces the German message
    // this module owns in one place.
    return readVoucherList(filePath)
  }
  if (
    cache &&
    cache.path === filePath &&
    cache.mtimeMs === stat.mtimeMs &&
    cache.size === stat.size &&
    Date.now() - cache.cachedAt < MAX_CACHE_AGE_MS
  ) {
    return cache.list
  }
  const list = await readVoucherList(filePath)
  cache = { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size, cachedAt: Date.now(), list }
  return list
}
