import zlib from 'zlib'
import { PDFArray, PDFDocument, PDFName } from 'pdf-lib'

/**
 * The text a contract PDF actually shows, read back off the page.
 *
 * Three layers sit between a drawn string and the bytes on disk. pdf-lib writes
 * the string as a Tj operator inside a Flate-compressed content stream, and
 * encodes it as hex — so a plain byte search finds nothing whether the text is
 * there or not. On top of that the contract is drawn with an embedded font (see
 * src/server/contractPdf.ts), and an embedded font is addressed by glyph id
 * under Identity-H: `Ondřej` reaches the page as `<000100020003000400050006>`,
 * and no byte-decoding gets a letter back out of it.
 *
 * What maps those ids to characters is the font's own ToUnicode CMap, which the
 * document carries — the same table a reader uses for copy-and-paste. Each
 * embedded subset numbers its glyphs from 1, so the id 0x0003 means one letter
 * in the bold face and a different one in the regular face: the tables cannot be
 * merged, and each run is decoded through the font its content stream names in
 * its own `/F 12 Tf` operator.
 */
export async function pdfText(bytes: Buffer): Promise<string> {
  const doc = await PDFDocument.load(bytes)
  let out = ''

  for (const page of doc.getPages()) {
    const context = page.node.context

    // Every font this page can address, by the name the content stream uses.
    const fonts = new Map<string, Map<string, string>>()
    const fontDict: any = page.node.Resources()?.lookup(PDFName.of('Font'))
    for (const [name, ref] of fontDict?.entries() ?? []) {
      const toUnicode = (context.lookup(ref) as any)?.get?.(PDFName.of('ToUnicode'))
      const stream: any = toUnicode && context.lookup(toUnicode)
      if (stream?.contents) fonts.set(name.asString(), parseCMap(inflate(stream)))
    }

    const contents = page.node.Contents()
    const parts = contents instanceof PDFArray ? contents.asArray() : [contents]
    let text = ''
    for (const part of parts) {
      const stream: any = part && context.lookup(part)
      if (stream?.contents) text += `${inflate(stream)}\n`
    }

    // One pass, in order, so a `Tf` decides how the hex strings after it read.
    let current: Map<string, string> | null = null
    out += text.replace(
      /(\/[^\s/<>[\]()]+)\s+[\d.]+\s+Tf|<([0-9A-Fa-f]+)>/g,
      (all, tf: string | undefined, hex: string | undefined) => {
        if (tf !== undefined) {
          current = fonts.get(tf) ?? null
          return all
        }
        if (hex === undefined || hex.length % 2 !== 0) return all
        const codes = current && hex.length % 4 === 0 ? hex.toLowerCase().match(/.{4}/g) : null
        // A standard font (the template's own text, a contract written by an
        // older version) hex-encodes plain bytes and has no table at all.
        if (codes?.every((c) => current!.has(c))) {
          return codes.map((c) => current!.get(c)).join('')
        }
        return Buffer.from(hex, 'hex').toString('latin1')
      }
    )
  }

  return out
}

function inflate(stream: { contents: Uint8Array }): string {
  const raw = Buffer.from(stream.contents)
  try {
    return zlib.inflateSync(raw).toString('latin1')
  } catch {
    return raw.toString('latin1')
  }
}

/** Glyph id (four hex digits) -> the character it stands for. */
function parseCMap(cmap: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const [, body] of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const [, code, value] of body.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>/g)) {
      map.set(code.toLowerCase(), Buffer.from(value, 'hex').swap16().toString('utf16le'))
    }
  }
  return map
}
