import { test, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { buildWorkbook, DEFAULT_COLUMNS } from '../src/server/excel'

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
