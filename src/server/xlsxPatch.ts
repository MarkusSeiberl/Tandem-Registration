import JSZip from 'jszip'

/**
 * Writes one date into one cell of an existing .xlsx, and changes nothing else.
 *
 * The club's voucher list is the only record it has of which vouchers it sold,
 * and it lives in OneDrive where every member sees it. The obvious way to put a
 * redemption date into it — read the workbook with ExcelJS, set the cell, write
 * the workbook back — rebuilds every part of the file from ExcelJS's own model.
 * Anything the model has no room for is silently dropped: formula caches,
 * charts, tables, conditional formatting, pivot caches, revision metadata. A
 * part that disappears while something still points at it is what makes Excel
 * announce unreadable content and repair the file on open, which is exactly
 * what happened to the club during testing.
 *
 * So this writer never parses the workbook. An .xlsx is a zip of XML parts; a
 * date in a cell is one numeric `<c>` element in one of them. Only that part is
 * touched (and `xl/styles.xml`, and only when the column has no date format of
 * its own), and every other part is carried across unread and unchanged.
 *
 * A date is stored as a number, so `xl/sharedStrings.xml` is never involved —
 * which is what keeps the change this small.
 */

export interface DateCellTarget {
  /** Sheet to write into, by the name on its tab. Not an index: the club's list runs one sheet per season. */
  sheetName: string
  /** 1-based sheet row, as ExcelJS counts them. */
  row: number
  /** 1-based column, as ExcelJS counts them. */
  column: number
  /** Written as the day it reads in UTC — see excelDay in ./voucherRedeem. */
  date: Date
}

// Excel's own date epoch. The 1900 system counts from 1899-12-30 (serial 25569
// is the Unix epoch); a workbook saved with the 1904 option counts from
// 1904-01-01. Which one applies is a property of the workbook, so it is read
// from the file rather than assumed.
const EPOCH_1900 = 25569
const EPOCH_1904 = 24107
const MS_PER_DAY = 86400000

// Number formats Excel ships built in. 14-22 are the date and time formats,
// 45-47 the elapsed-time ones; a cell carrying any of them already displays a
// serial number as a date, so nothing has to be added to the style table.
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&')

/** The value of `name` on an XML open tag, or null when the tag does not carry it. */
function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*"([^"]*)"`))
  return match ? decodeXml(match[1]) : null
}

/** `tag` without `name`, whether or not it had it. */
const withoutAttribute = (tag: string, name: string) =>
  tag.replace(new RegExp(`\\s${name.replace(':', '\\:')}\\s*=\\s*"[^"]*"`), '')

export function columnLetter(column: number): string {
  let letters = ''
  let n = column
  while (n > 0) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters
    n = Math.floor((n - 1) / 26)
  }
  return letters
}

export function columnIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/** The column part of a cell reference such as "AB12". */
const refColumn = (ref: string) => columnIndex(ref.replace(/\d+$/, ''))

interface Element {
  /** Index of the '<' that opens it. */
  start: number
  /** Index just past its last character. */
  end: number
  /** The open tag, `<row r="2">` or `<row r="2"/>`. */
  openTag: string
  /** Index just past the open tag; equals `end` when the element is self-closing. */
  contentStart: number
  selfClosing: boolean
}

/**
 * Every direct `<tag>` element in `xml` between `from` and `to`.
 *
 * Rows do not nest inside rows and cells do not nest inside cells, so finding
 * the closing tag by simple search is exact for the two tags this module walks.
 */
function elementsOf(xml: string, tag: string, from: number, to: number): Element[] {
  const open = new RegExp(`<${tag}\\b([^>]*?)(/?)>`, 'g')
  const close = `</${tag}>`
  open.lastIndex = from
  const found: Element[] = []
  let match
  while ((match = open.exec(xml)) !== null) {
    if (match.index >= to) break
    const selfClosing = match[2] === '/'
    const contentStart = match.index + match[0].length
    const end = selfClosing ? contentStart : xml.indexOf(close, contentStart) + close.length
    found.push({ start: match.index, end, openTag: match[0], contentStart, selfClosing })
    open.lastIndex = end
  }
  return found
}

/** The part path of the sheet with this tab name, e.g. "xl/worksheets/sheet3.xml". */
function sheetPartPath(workbookXml: string, relsXml: string, sheetName: string): string {
  const sheets = workbookXml.match(/<sheet\b[^>]*\/?>/g) ?? []
  const sheet = sheets.find((tag) => attribute(tag, 'name') === sheetName)
  if (!sheet) {
    const names = sheets.map((tag) => attribute(tag, 'name')).filter(Boolean)
    throw new Error(
      `Die Gutscheinliste hat kein Tabellenblatt "${sheetName}" (vorhanden: ${names.join(', ')}).`
    )
  }
  const id = attribute(sheet, 'r:id')
  const relationship = (relsXml.match(/<Relationship\b[^>]*\/?>/g) ?? [])
    .find((tag) => attribute(tag, 'Id') === id)
  const target = relationship && attribute(relationship, 'Target')
  if (!target) {
    throw new Error(`Das Tabellenblatt "${sheetName}" der Gutscheinliste ist nicht auffindbar.`)
  }
  // Sheet targets are written relative to xl/, and Excel also writes them with
  // a leading slash from the package root.
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
}

interface StyleTable {
  xml: string
  /** Serialised `<xf>` open tags of cellXfs, in index order. */
  cellXfs: string[]
  /** Custom numFmtId -> format code. */
  numFmts: Map<number, string>
  changed: boolean
}

function readStyles(xml: string): StyleTable {
  const cellXfsStart = xml.indexOf('<cellXfs')
  const cellXfs = cellXfsStart === -1
    ? []
    : elementsOf(xml, 'xf', cellXfsStart, xml.indexOf('</cellXfs>'))
      .map((element) => element.openTag)

  const numFmts = new Map<number, string>()
  for (const tag of xml.match(/<numFmt\b[^>]*\/?>/g) ?? []) {
    const id = Number(attribute(tag, 'numFmtId'))
    const code = attribute(tag, 'formatCode')
    if (Number.isFinite(id) && code !== null) numFmts.set(id, code)
  }
  return { xml, cellXfs, numFmts, changed: false }
}

/**
 * Whether a style index already displays a number as a date.
 *
 * A custom format is decided by what is left of its code once the parts that
 * never carry a field code are removed — quoted literals, the bracketed colour
 * and condition sections, and backslash-escaped characters. `y` or `d` in what
 * remains is a date; a bare `m` is not enough, because it is also the minute
 * placeholder in a pure time format.
 */
function isDateStyle(styles: StyleTable, index: number): boolean {
  const xf = styles.cellXfs[index]
  if (!xf) return false
  const numFmtId = Number(attribute(xf, 'numFmtId') ?? 0)
  if (BUILTIN_DATE_FORMATS.has(numFmtId)) return true
  const code = styles.numFmts.get(numFmtId)
  if (!code) return false
  const bare = code.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '').replace(/\\./g, '')
  return /[yd]/i.test(bare)
}

/**
 * A style index that shows this cell's value as a date.
 *
 * When the column already has a date format — the normal case, because the club
 * has been filling this column in by hand for years — that format is used as it
 * stands, and the style table is not touched at all. Otherwise a copy of the
 * base style with the built-in date format is appended. Appending never
 * renumbers the existing entries, so no other cell in the workbook changes
 * appearance; assigning a format to the shared style record instead would
 * restyle every cell that happens to share it.
 */
function dateStyleIndex(styles: StyleTable, base: number | null): number | null {
  if (base !== null && isDateStyle(styles, base)) return base

  const cellXfsOpen = styles.xml.match(/<cellXfs\b[^>]*>/)
  const cellXfsEnd = styles.xml.indexOf('</cellXfs>')
  if (!cellXfsOpen || cellXfsEnd === -1) return base

  const template = (base !== null && styles.cellXfs[base]) || '<xf numFmtId="0" xfId="0">'
  const dated = `${withoutAttribute(withoutAttribute(template, 'numFmtId'), 'applyNumberFormat')
    .replace(/\/?>$/, '')} numFmtId="14" applyNumberFormat="1"/>`

  const index = styles.cellXfs.length
  styles.cellXfs.push(dated)
  styles.xml =
    styles.xml.slice(0, cellXfsEnd) + dated + styles.xml.slice(cellXfsEnd)
  styles.xml = styles.xml.replace(
    cellXfsOpen[0],
    withoutAttribute(cellXfsOpen[0], 'count').replace(/\/?>$/, ` count="${index + 1}">`)
  )
  styles.changed = true
  return index
}

/**
 * The style the new cell should inherit from: the cell's own if it has one,
 * otherwise whatever the rest of the column uses. A column of dates the club
 * typed in itself is the best available description of how this one should look.
 */
function baseStyleFor(
  sheetXml: string, styles: StyleTable, column: number, existing: string | null
): number | null {
  if (existing !== null) {
    const own = attribute(existing, 's')
    if (own !== null) return Number(own)
  }

  const letter = columnLetter(column)
  const inColumn = new RegExp(`<c\\b[^>]*\\sr="${letter}\\d+"[^>]*>`, 'g')
  let fallback: number | null = null
  for (const tag of sheetXml.match(inColumn) ?? []) {
    const s = attribute(tag, 's')
    if (s === null) continue
    const index = Number(s)
    if (isDateStyle(styles, index)) return index
    if (fallback === null) fallback = index
  }
  if (fallback !== null) return fallback

  for (const tag of sheetXml.match(/<col\b[^>]*\/?>/g) ?? []) {
    const min = Number(attribute(tag, 'min') ?? 0)
    const max = Number(attribute(tag, 'max') ?? 0)
    const style = attribute(tag, 'style')
    if (style !== null && column >= min && column <= max) return Number(style)
  }
  return null
}

/** `<dimension>` widened so it covers `ref`. Excel treats it as a hint, but a stale one reads as damage. */
function widenDimension(xml: string, column: number, row: number): string {
  const match = xml.match(/<dimension\b[^>]*\/?>/)
  if (!match) return xml
  const ref = attribute(match[0], 'ref')
  if (!ref) return xml
  const [from, to = from] = ref.split(':')
  const parse = (cell: string) => ({ column: refColumn(cell), row: Number(cell.replace(/^[A-Z]+/, '')) })
  const start = parse(from)
  const end = parse(to)
  const widened =
    `${columnLetter(Math.min(start.column, column))}${Math.min(start.row, row)}:` +
    `${columnLetter(Math.max(end.column, column))}${Math.max(end.row, row)}`
  return ref === widened ? xml : xml.replace(match[0], `<dimension ref="${widened}"/>`)
}

/** A row's `spans` hint widened to cover `column`, or dropped when it cannot be read. */
function widenSpans(openTag: string, column: number): string {
  const spans = attribute(openTag, 'spans')
  if (spans === null) return openTag
  const bounds = spans.split(/\s+/).flatMap((range) => range.split(':').map(Number))
  if (bounds.some((n) => !Number.isFinite(n))) return withoutAttribute(openTag, 'spans')
  const min = Math.min(...bounds, column)
  const max = Math.max(...bounds, column)
  return `${spans}` === `${min}:${max}`
    ? openTag
    : withoutAttribute(openTag, 'spans').replace(/(\/?)>$/, ` spans="${min}:${max}"$1>`)
}

/** Every part an .xlsx holds, by name. Used to prove a write dropped none of them. */
export async function xlsxPartNames(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer)
  return Object.keys(zip.files).filter((name) => !zip.files[name].dir).sort()
}

export async function patchDateCell(source: Buffer, target: DateCellTarget): Promise<Buffer> {
  const zip = await JSZip.loadAsync(source)

  const read = async (part: string): Promise<string | null> => {
    const file = zip.file(part)
    return file ? file.async('string') : null
  }

  const workbookXml = await read('xl/workbook.xml')
  const relsXml = await read('xl/_rels/workbook.xml.rels')
  if (workbookXml === null || relsXml === null) {
    throw new Error('Die Gutscheinliste ist keine lesbare Excel-Datei.')
  }
  const part = sheetPartPath(workbookXml, relsXml, target.sheetName)
  const original = await read(part)
  if (original === null) throw new Error(`Die Gutscheinliste hat keinen Teil "${part}".`)

  const epoch = /<workbookPr\b[^>]*\sdate1904\s*=\s*"(1|true)"/.test(workbookXml)
    ? EPOCH_1904
    : EPOCH_1900
  const serial = epoch + target.date.getTime() / MS_PER_DAY

  const stylesXml = await read('xl/styles.xml')
  const styles = stylesXml === null ? null : readStyles(stylesXml)

  // <sheetData/> is how Excel writes a sheet with no rows at all; give it a body
  // so a row can be put inside it.
  let xml = original.replace(/<sheetData\s*\/>/, '<sheetData></sheetData>')
  const dataOpen = xml.match(/<sheetData\b[^>]*>/)
  if (!dataOpen) throw new Error(`Der Teil "${part}" der Gutscheinliste hat keine Zeilen.`)
  const dataStart = xml.indexOf(dataOpen[0]) + dataOpen[0].length
  const dataEnd = xml.indexOf('</sheetData>', dataStart)

  const ref = `${columnLetter(target.column)}${target.row}`
  const rows = elementsOf(xml, 'row', dataStart, dataEnd)
  const row = rows.find((r) => Number(attribute(r.openTag, 'r')) === target.row)

  const existingCell = row && !row.selfClosing
    ? elementsOf(xml, 'c', row.contentStart, row.end)
      .find((c) => attribute(c.openTag, 'r') === ref)
    : undefined

  const styleIndex = styles === null
    ? null
    : dateStyleIndex(styles, baseStyleFor(xml, styles, target.column, existingCell?.openTag ?? null))

  // `t` says how <v> is to be read, and a date is a plain number: a `t="s"`
  // left over from a text value would make Excel look the serial up in the
  // shared string table.
  const cellOpen = withoutAttribute(
    withoutAttribute(existingCell?.openTag ?? `<c r="${ref}"/>`, 't'), 's'
  ).replace(/\/?>$/, styleIndex === null ? '>' : ` s="${styleIndex}">`)
  const cell = `${cellOpen}<v>${serial}</v></c>`

  if (existingCell) {
    xml = xml.slice(0, existingCell.start) + cell + xml.slice(existingCell.end)
  } else if (row) {
    // A self-closing <row/> has to become a container before it can hold a cell.
    const openTag = widenSpans(row.openTag, target.column)
    if (row.selfClosing) {
      xml = xml.slice(0, row.start) +
        `${openTag.replace(/\/>$/, '>')}${cell}</row>` +
        xml.slice(row.end)
    } else {
      // Cells within a row must stay in column order, so the new one goes before
      // the first cell to its right rather than at the end.
      const after = elementsOf(xml, 'c', row.contentStart, row.end)
        .find((c) => refColumn(attribute(c.openTag, 'r') ?? 'A1') > target.column)
      const at = after ? after.start : row.end - '</row>'.length
      xml = xml.slice(0, at) + cell + xml.slice(at)
      xml = xml.slice(0, row.start) + openTag + xml.slice(row.start + row.openTag.length)
    }
  } else {
    // Same rule one level up: rows must stay in row order.
    const after = rows.find((r) => Number(attribute(r.openTag, 'r')) > target.row)
    const at = after ? after.start : dataEnd
    xml = xml.slice(0, at) +
      `<row r="${target.row}" spans="${target.column}:${target.column}">${cell}</row>` +
      xml.slice(at)
  }

  zip.file(part, widenDimension(xml, target.column, target.row))
  if (styles?.changed) zip.file('xl/styles.xml', styles.xml)

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
