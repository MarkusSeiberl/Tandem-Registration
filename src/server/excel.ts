import ExcelJS from 'exceljs'
import type { PayoutSection } from './payouts'

// `numFmt` marks a column whose values stay real numbers in the sheet (so the
// club can sum them itself) and only get their currency suffix from the cell
// format. Everything else is written as-is.
export const EURO_FORMAT = '#,##0.00 "€"'

export interface Column {
  key: string
  header: string
  numFmt?: string
  // Overrides the uniform column width below. Only worth setting for a column
  // whose content is a sentence rather than a name or an amount.
  width?: number
}

export const DEFAULT_COLUMNS: Column[] = [
  { key: 'first_name', header: 'Vorname' },
  { key: 'last_name', header: 'Nachname' },
  { key: 'gender', header: 'Geschlecht' },
  { key: 'address', header: 'Adresse' },
  { key: 'email', header: 'E-Mail' },
  { key: 'phone', header: 'Telefon' },
  { key: 'tandem_master_id', header: 'Tandemmaster' },
  { key: 'load_number', header: 'Load-Nr.' },
  { key: 'price', header: 'Preis', numFmt: EURO_FORMAT },
  { key: 'payment_method', header: 'Zahlungsart' },
  { key: 'voucher_payment_method', header: 'Zuzahlung mit' },
  { key: 'voucher_number', header: 'Gutschein-Nr.' },
  { key: 'voucher_service', header: 'Gutschein-Leistung' },
  { key: 'extra_booking', header: 'Leistung' },
  { key: 'weight_surcharge', header: 'Zuschlag' },
  { key: 'camera_flyer_id', header: 'Kameraflieger' },
  // Last, and wide: this is where a special arrangement gets explained, and an
  // explanation clipped to the standard width is one nobody can read.
  { key: 'notes', header: 'Anmerkungen', width: 50 },
]

export interface MetaRow {
  label: string
  value: string
}

export interface TotalRow {
  label: string
  amount: number
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8F5EC' },
}

const THIN_BOTTOM_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: 'FFDDE2E8' } },
}

// The payout block writes name / calculation / amount into the first three
// columns. Those hold guest data in the rows above, which is narrower than a
// calculation like "3 × 45,00 € + 1 × 15,00 € + 1 × 25,00 €" — the columns are
// widened to fit both rather than clipping the arithmetic the block exists to show.
const PAYOUT_COLUMN_WIDTHS = [26, 40, 14]

export async function buildWorkbook(
  rows: any[],
  columns: Column[] = DEFAULT_COLUMNS,
  meta: MetaRow[] = [],
  totals: TotalRow[] = [],
  payouts: PayoutSection[] = []
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tandem')

  for (const m of meta) {
    const row = ws.addRow([m.label, m.value])
    row.getCell(1).font = { bold: true }
  }
  if (meta.length) ws.addRow([])

  const headerRow = ws.addRow(columns.map(c => c.header))
  headerRow.eachCell(cell => {
    cell.font = { bold: true }
    cell.fill = HEADER_FILL
    cell.border = THIN_BOTTOM_BORDER
  })

  for (const r of rows) {
    const row = ws.addRow(columns.map(c => r[c.key] ?? ''))
    row.eachCell(cell => { cell.border = THIN_BOTTOM_BORDER })
    columns.forEach((c, i) => {
      // Only format a cell that actually holds a number — an empty price would
      // otherwise render as the string '' with a currency suffix attached.
      if (c.numFmt && typeof row.getCell(i + 1).value === 'number') {
        row.getCell(i + 1).numFmt = c.numFmt
      }
    })
  }

  // Summenblock: the reason the sheet exists at the end of a jump day — what was
  // taken in, split by how it was paid. Written two columns wide so it reads next
  // to the rows above without disturbing their layout.
  if (totals.length) {
    ws.addRow([])
    for (const t of totals) {
      const row = ws.addRow([t.label, t.amount])
      row.getCell(1).font = { bold: true }
      row.getCell(2).font = { bold: true }
      row.getCell(2).numFmt = EURO_FORMAT
    }
  }

  // Vergütungsblock: what the club owes its crew for the day. Each line carries
  // the arithmetic beside the amount, so a figure can be checked without counting
  // the guest rows again.
  for (const section of payouts) {
    ws.addRow([])
    ws.addRow([section.title]).getCell(1).font = { bold: true }
    for (const entry of section.entries) {
      const row = ws.addRow([entry.name, entry.calculation, entry.amount])
      row.getCell(3).numFmt = EURO_FORMAT
    }
    const total = ws.addRow(['Summe', '', section.total])
    total.getCell(1).font = { bold: true }
    total.getCell(3).font = { bold: true }
    total.getCell(3).numFmt = EURO_FORMAT
  }

  columns.forEach((c, i) => { ws.getColumn(i + 1).width = c.width ?? 18 })
  if (payouts.length) {
    PAYOUT_COLUMN_WIDTHS.forEach((width, i) => {
      const column = ws.getColumn(i + 1)
      column.width = Math.max(column.width ?? 0, width)
    })
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
