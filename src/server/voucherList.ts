import type { VoucherService } from './pricing'
import ExcelJS from 'exceljs'

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
  sheetName: string
  /** Normalised number -> every row carrying it. More than one means ambiguous. */
  byNumber: Map<string, VoucherEntry[]>
}

const REQUIRED_HEADERS = ['lfdnr', 'einzahldat', 'eingelöst'] as const

// The club's sheet already carries a stray "Spalte1"; anyone inserting a column
// must not silently shift the reader onto the wrong data, so columns are located
// by their header text rather than by position.
function headerColumns(sheet: ExcelJS.Worksheet): Map<string, number> {
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

// ExcelJS hands back a hyperlink (or rich-text) cell as { text, hyperlink }
// instead of a plain scalar. Every cell reader — header or data — routes
// through this so a hyperlinked column can't silently stringify to
// "[object Object]" in one path while working in another.
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

function cellText(value: ExcelJS.CellValue): string | null {
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
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('Die Gutscheinliste enthält kein Tabellenblatt.')

  const columns = headerColumns(sheet)
  const missing = REQUIRED_HEADERS.filter((h) => !columns.has(h))
  if (missing.length > 0) {
    const names = missing.map((m) => (m === 'eingelöst' ? 'Eingelöst' : m === 'lfdnr' ? 'LfdNr' : 'EinzahlDat'))
    throw new Error(`In der Gutscheinliste fehlt die Spalte ${names.join(', ')}.`)
  }

  const at = (row: ExcelJS.Row, key: string) => {
    const index = columns.get(key)
    return index === undefined ? null : row.getCell(index).value
  }

  const byNumber = new Map<string, VoucherEntry[]>()
  // A hand-edited sheet's dimension metadata can disagree with its actual
  // content, which makes sheet.rowCount an untrustworthy scan bound;
  // eachRow walks the real rows instead. rowNumber stays the true 1-based
  // sheet row — a later task writes a redemption date back into it.
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
      rowNumber,
      paidAt: paid.date,
      paidText: paid.text,
      amount: cellNumber(at(row, 'betrag')),
      art,
      service,
      isAddOn,
      redeemedAt: cellDate(at(row, 'eingelöst')).date,
    }
    const key = normaliseVoucherNumber(number)
    const existing = byNumber.get(key)
    if (existing) existing.push(entry)
    else byNumber.set(key, [entry])
  })

  return { sheetName: sheet.name, byNumber }
}
