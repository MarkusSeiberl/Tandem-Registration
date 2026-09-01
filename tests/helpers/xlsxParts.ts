import ExcelJS from 'exceljs'
import JSZip from 'jszip'

/**
 * Every part of an .xlsx, by name, as raw bytes.
 *
 * An .xlsx is a zip of XML parts. The point of the surgical writer is that it
 * changes exactly one of them, so the assertion the club's file depends on is
 * "every other part came back identical" — which needs the parts themselves,
 * not what a parser makes of them. Compression is deliberately ignored: two
 * zips holding the same bytes under different deflate settings are the same
 * workbook, and Excel reads both.
 */
export async function xlsxParts(buffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(buffer)
  const parts = new Map<string, Buffer>()
  const names = Object.keys(zip.files).sort()
  for (const name of names) {
    const entry = zip.files[name]
    if (entry.dir) continue
    parts.set(name, Buffer.from(await entry.async('nodebuffer')))
  }
  return parts
}

/** The parts of `after` that differ from `before`, added or removed included. */
export async function changedParts(before: Buffer, after: Buffer): Promise<string[]> {
  const a = await xlsxParts(before)
  const b = await xlsxParts(after)
  const names = new Set([...a.keys(), ...b.keys()])
  const changed: string[] = []
  for (const name of [...names].sort()) {
    const one = a.get(name)
    const two = b.get(name)
    if (!one || !two || !one.equals(two)) changed.push(name)
  }
  return changed
}

/**
 * A workbook carrying the kinds of part ExcelJS does not model.
 *
 * The club's real list is years of Excel edits: formula caches, a chart, an
 * Excel table. None of it survives a read-into-model-and-write-a-new-workbook
 * cycle, and a part that vanishes while something still points at it is what
 * makes Excel announce unreadable content and repair the file. These stand in
 * for that in a test: they only have to be present and byte-identical
 * afterwards, so their contents are the smallest well-formed XML that carries
 * the right content type.
 */
export async function workbookWithForeignParts(
  build: (sheet: ExcelJS.Worksheet) => void,
  options: { sheetNames?: string[] } = {}
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  for (const name of options.sheetNames ?? ['Tabelle1']) {
    build(wb.addWorksheet(name))
  }
  const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()))

  zip.file('xl/calcChain.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<c r="B2" i="1"/></calcChain>')
  zip.file('xl/charts/chart1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>')
  zip.file('xl/tables/table1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'id="1" name="Gutscheine" displayName="Gutscheine" ref="A1:B2">' +
    '<tableColumns count="1"><tableColumn id="1" name="LfdNr"/></tableColumns></table>')

  return zip.generateAsync({ type: 'nodebuffer' })
}

export const FOREIGN_PARTS = ['xl/calcChain.xml', 'xl/charts/chart1.xml', 'xl/tables/table1.xml']

/**
 * Adds the same unmodellable parts to a workbook already on disk.
 *
 * Same purpose as workbookWithForeignParts, for the tests that need a real
 * voucher file — written by the voucher helper, with the columns the reader
 * expects — rather than a hand-built sheet.
 */
export async function addForeignParts(filePath: string): Promise<void> {
  const { promises: fs } = await import('fs')
  const zip = await JSZip.loadAsync(await fs.readFile(filePath))
  zip.file('xl/calcChain.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<c r="B2" i="1"/></calcChain>')
  zip.file('xl/charts/chart1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>')
  zip.file('xl/tables/table1.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'id="1" name="Gutscheine" displayName="Gutscheine" ref="A1:B2">' +
    '<tableColumns count="1"><tableColumn id="1" name="LfdNr"/></tableColumns></table>')
  await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
}
