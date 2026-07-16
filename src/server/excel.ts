import ExcelJS from 'exceljs'

export const DEFAULT_COLUMNS = [
  { key: 'first_name', header: 'Vorname' },
  { key: 'last_name', header: 'Nachname' },
  { key: 'age', header: 'Alter' },
  { key: 'weight_kg', header: 'Gewicht (kg)' },
  { key: 'address', header: 'Adresse' },
  { key: 'email', header: 'E-Mail' },
  { key: 'phone', header: 'Telefon' },
  { key: 'tandem_master_id', header: 'Tandemmaster' },
  { key: 'load_number', header: 'Load-Nr.' },
  { key: 'price', header: 'Preis' },
  { key: 'payment_method', header: 'Zahlungsart' },
  { key: 'extra_booking', header: 'Zusatz' },
  { key: 'camera_flyer_id', header: 'Kameraflieger' },
]

export async function buildWorkbook(
  rows: any[],
  columns: { key: string; header: string }[] = DEFAULT_COLUMNS
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tandem')
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: 18 }))
  for (const r of rows) ws.addRow(r)
  return Buffer.from(await wb.xlsx.writeBuffer())
}
