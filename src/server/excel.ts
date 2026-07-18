import ExcelJS from 'exceljs'

export const DEFAULT_COLUMNS = [
  { key: 'first_name', header: 'Vorname' },
  { key: 'last_name', header: 'Nachname' },
  { key: 'gender', header: 'Geschlecht' },
  { key: 'address', header: 'Adresse' },
  { key: 'email', header: 'E-Mail' },
  { key: 'phone', header: 'Telefon' },
  { key: 'tandem_master_id', header: 'Tandemmaster' },
  { key: 'load_number', header: 'Load-Nr.' },
  { key: 'price', header: 'Preis' },
  { key: 'payment_method', header: 'Zahlungsart' },
  { key: 'voucher_number', header: 'Gutschein-Nr.' },
  { key: 'extra_booking', header: 'Zusatz' },
  { key: 'camera_flyer_id', header: 'Kameraflieger' },
]

export interface MetaRow {
  label: string
  value: string
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE8F5EC' },
}

const THIN_BOTTOM_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: 'thin', color: { argb: 'FFDDE2E8' } },
}

export async function buildWorkbook(
  rows: any[],
  columns: { key: string; header: string }[] = DEFAULT_COLUMNS,
  meta: MetaRow[] = []
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
  }

  columns.forEach((_, i) => { ws.getColumn(i + 1).width = 18 })

  return Buffer.from(await wb.xlsx.writeBuffer())
}
