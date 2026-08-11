import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

export type VoucherFileRow = {
  lfdNr?: string
  einzahlDat?: Date | string | null
  // A plain string for most rows, or an ExcelJS hyperlink-cell shape to
  // exercise a data column holding a hyperlink instead of plain text.
  art?: string | { text: string; hyperlink: string }
  betrag?: number
  eingeloest?: Date | null
}

// Mirrors the club's real sheet: header row 1, one sheet named "Tabelle1", and
// a stray trailing column — the reader must find its columns by name, not by
// counting from the left.
const DEFAULT_HEADERS = [
  'LfdNr', 'AusstellDat', 'EinzahlDat', 'Art', 'Betrag',
  'Nachname', 'Vorname', 'Eingelöst', 'E-Mail', 'Spalte1',
]

export async function writeVoucherFile(
  rows: VoucherFileRow[],
  options: { headers?: string[] } = {}
): Promise<string> {
  const headers = options.headers ?? DEFAULT_HEADERS
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tabelle1')
  ws.addRow(headers)
  for (const row of rows) {
    const cells = headers.map((header) => {
      if (header === 'LfdNr') return row.lfdNr ?? ''
      if (header === 'EinzahlDat') return row.einzahlDat ?? null
      if (header === 'Art') return row.art ?? ''
      if (header === 'Betrag') return row.betrag ?? null
      if (header === 'Eingelöst') return row.eingeloest ?? null
      return ''
    })
    ws.addRow(cells)
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-vouchers-'))
  const filePath = path.join(dir, 'Tandemliste.xlsx')
  await wb.xlsx.writeFile(filePath)
  return filePath
}
