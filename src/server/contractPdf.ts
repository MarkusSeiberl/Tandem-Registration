import fs from 'fs'
import fontkit from '@pdf-lib/fontkit'
import { PDFArray, PDFDocument, PDFFont, PDFName, PDFRef, rgb } from 'pdf-lib'
import { assetPath } from './assets'

// The club jumps 30 km from the Czech border and its guests come from there,
// from Poland, from Turkey. None of those alphabets fit in WinAnsi, which is
// all the PDF standard fonts (Helvetica and friends) can encode: drawing a
// guest called Ondřej threw `WinAnsi cannot encode "ř"` — inside the
// registration route, before the row was ever written. The guest could not
// register at all, and the tablet only said "Server-Fehler. Bitte erneut
// versuchen." Retrying never helped, because nothing about the retry differed.
//
// So the contract is drawn with a font that carries those letters. DejaVu Sans
// Condensed rather than DejaVu Sans proper: the header blanks are filled at
// fixed coordinates measured against Helvetica, and Condensed is within ~3% of
// Helvetica's width where the regular face is ~13% wider — enough for a long
// e-mail address to run out of its blank and into the next field.
//
// Both faces ship in assets/ (licence beside them) and are embedded subset, so
// a contract carries only the glyphs it actually uses — a few kB, not the 660 kB
// of the file.
const FONT_FILES = {
  regular: 'DejaVuSansCondensed.ttf',
  bold: 'DejaVuSansCondensed-Bold.ttf',
} as const

export const FONT_ASSETS = Object.values(FONT_FILES)

type FontWeight = keyof typeof FONT_FILES

// Read once and kept: every registration draws a contract, and the two files
// are 1.3 MB of unchanging bytes.
const fontCache = new Map<FontWeight, Buffer>()

function fontBytes(weight: FontWeight): Buffer {
  const cached = fontCache.get(weight)
  if (cached) return cached
  const bytes = fs.readFileSync(assetPath(FONT_FILES[weight]))
  fontCache.set(weight, bytes)
  return bytes
}

// Embedding is per document, and pdf-lib has no way to look up a font a
// previously saved document already carries. A contract re-stamped several
// times therefore accumulates one small subset per stamp; at a few kB each that
// is not worth the risk of pruning font resources out of a signed PDF.
async function embedFont(doc: PDFDocument, weight: FontWeight): Promise<PDFFont> {
  doc.registerFontkit(fontkit)
  return doc.embedFont(fontBytes(weight), { subset: true })
}

export interface ContractPdfData {
  firstName: string
  lastName: string
  street: string
  postalCode: string
  city: string
  phone: string
  email: string
  age: number
  heightCm: number
  weightKg: number
  ort: string
  datum: string
  signaturePngDataUrl: string
}

const FONT_SIZE = 12
const SMALL_FONT_SIZE = 10

// The template's header fields and Ort/Datum/Unterschrift blanks are flat text
// with underlines, not an AcroForm — so filling means drawing text/an image on
// top at fixed coordinates rather than setting named form field values.
// Coordinates measured directly against assets/Befoerderungsvertrag.pdf (595x842pt A4).
const PAGE1 = {
  name: { x: 118, y: 690 },
  street: { x: 203, y: 660 },
  plzCity: { x: 165, y: 632 },
  phone: { x: 95, y: 608, size: SMALL_FONT_SIZE },
  email: { x: 290, y: 608, size: SMALL_FONT_SIZE },
  age: { x: 90, y: 580 },
  height: { x: 180, y: 580 },
  weight: { x: 315, y: 580 },
}

// The two header fields the kiosk cannot fill: the manifest only learns them
// when the guest hands the voucher over and a master takes the jump, long after
// the contract was signed and written to disk. Both are therefore stamped onto
// the finished PDF rather than drawn at signing time.
//
// The voucher number goes in the box at the top-left, where the operator sees it
// without unfolding the page. Bare number, no label: the line it sits on already
// says what it is.
//
// The Tandemmaster has a blank of its own in the header, one row above
// Herr/Frau, on the club's own dotted line — the same place a pen would go. It
// is drawn like the guest's data beside it rather than like the voucher stamp:
// it is a header field, not a note added to the page, and bold in the middle of
// that block would read as a correction.
//
// Neither gets a white box behind it, which makes removing the previous content
// stream (see STAMP_KEY below) the *only* thing standing between a corrected
// value and a contract showing two of them. That mechanism is not an
// optimisation here — it is the erase.
const VOUCHER_STAMP = { x: 105, y: 796, size: 11 }
const MASTER_STAMP = { x: 156, y: 713, size: FONT_SIZE }

const PAGE2 = {
  ort: { x: 85, y: 82 },
  // The Datum blank is only ~60pt wide (right after the "Datum:" label,
  // before "Unterschrift:" starts around x=300) — too narrow for a full
  // dd.mm.yyyy date at 10pt, hence the smaller size here.
  datum: { x: 220, y: 82, size: 9 },
  signature: { x: 440, y: 84, width: 90, height: 36 },
  // Caption under the signature blank for guests under 18. Small enough to sit
  // beneath the pre-printed line without touching the page edge.
  guardian: { x: 360, y: 70, size: 7 },
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

export async function fillContractPdf(
  templateBytes: Uint8Array,
  data: ContractPdfData
): Promise<Buffer> {
  const doc = await PDFDocument.load(templateBytes)
  const font = await embedFont(doc, 'regular')
  const [page1, page2] = doc.getPages()
  const black = rgb(0, 0, 0)

  const draw = (
    page: typeof page1,
    text: string,
    spec: { x: number; y: number; size?: number }
  ) => page.drawText(text, { x: spec.x, y: spec.y, size: spec.size ?? FONT_SIZE, font, color: black })

  draw(page1, `${data.firstName} ${data.lastName}`, PAGE1.name)
  draw(page1, data.street, PAGE1.street)
  draw(page1, `${data.postalCode} ${data.city}`, PAGE1.plzCity)
  draw(page1, data.phone, PAGE1.phone)
  draw(page1, data.email, PAGE1.email)
  draw(page1, String(data.age), PAGE1.age)
  draw(page1, `${data.heightCm} cm`, PAGE1.height)
  draw(page1, `${data.weightKg} kg`, PAGE1.weight)

  draw(page2, data.ort, PAGE2.ort)
  draw(page2, data.datum, PAGE2.datum)

  if (data.age < 18) {
    draw(page2, 'gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre', PAGE2.guardian)
  }

  const signatureImage = await doc.embedPng(dataUrlToBytes(data.signaturePngDataUrl))
  page2.drawImage(signatureImage, {
    x: PAGE2.signature.x,
    y: PAGE2.signature.y,
    width: PAGE2.signature.width,
    height: PAGE2.signature.height,
  })

  const bytes = await doc.save()
  return Buffer.from(bytes)
}

// Marks the content stream this module last stamped onto page 1, so a re-stamp
// drops it instead of layering a second one on top. With no white box to hide
// behind, this is what makes a correction a correction: without it the contract
// would show both values, overprinted. A private key in the page dictionary is
// ignored by every reader.
//
// The name still says Voucher because contracts stamped before the Tandemmaster
// was added carry exactly this key. Renaming it would leave their stamp
// unfindable, and the next correction would print the new number over the old
// one instead of replacing it.
const STAMP_KEY = PDFName.of('TandemVoucherStamp')

function contentStreamRefs(page: ReturnType<PDFDocument['getPages']>[number]): PDFArray | undefined {
  const contents = page.node.get(PDFName.of('Contents'))
  const resolved = contents instanceof PDFRef ? page.node.context.lookup(contents) : contents
  return resolved instanceof PDFArray ? resolved : undefined
}

export interface ContractStamps {
  voucherNumber: string | null
  tandemMaster: string | null
}

// Stamps (or clears) the two late-arriving header fields on an already-generated
// contract PDF. Re-stampable by design: the previous stamp is removed first, so
// calling this repeatedly leaves exactly one voucher number and one Tandemmaster
// in the document, and empty values leave none.
//
// Both travel together, in one content stream, because the erase works on
// streams: two stamps would need two keys, two removals and two chances for a
// half-erased contract. The caller passes what the row says now, not what
// changed — which is also what makes a correction to either field redraw both
// correctly.
export async function stampContract(
  pdfBytes: Uint8Array,
  stamps: ContractStamps
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes)
  const [page1] = doc.getPages()

  const previous = page1.node.get(STAMP_KEY)
  if (previous instanceof PDFRef) {
    const contents = contentStreamRefs(page1)
    const index = contents?.asArray()
      .findIndex((ref) => ref instanceof PDFRef && ref.toString() === previous.toString())
    if (contents && index !== undefined && index >= 0) contents.remove(index)
    // Dropping it from Contents only unlinks it — the object would still be
    // written out, and the old number would still be in the file for anyone who
    // looks past the renderer. Delete it outright.
    page1.node.context.delete(previous)
    page1.node.delete(STAMP_KEY)
  }

  // Counted before drawing, because an empty number draws nothing at all. Without
  // this guard the "last stream on the page" below would be one of the template's
  // own, and the next call would delete a piece of the contract.
  const before = contentStreamRefs(page1)?.size() ?? 0

  const number = stamps.voucherNumber?.trim() ?? ''
  if (number.length > 0) {
    page1.drawText(number, {
      x: VOUCHER_STAMP.x,
      y: VOUCHER_STAMP.y,
      size: VOUCHER_STAMP.size,
      font: await embedFont(doc, 'bold'),
      color: rgb(0, 0, 0),
    })
  }

  const master = stamps.tandemMaster?.trim() ?? ''
  if (master.length > 0) {
    // The same content stream as the number above: pdf-lib reuses the stream it
    // created for the first draw call, which is what lets one key erase both.
    page1.drawText(master, {
      x: MASTER_STAMP.x,
      y: MASTER_STAMP.y,
      size: MASTER_STAMP.size,
      font: await embedFont(doc, 'regular'),
      color: rgb(0, 0, 0),
    })
  }

  // pdf-lib appends the operators above to a content stream it registers on the
  // first draw call, so the stream just added is the last one on the page.
  const streams = contentStreamRefs(page1)?.asArray() ?? []
  const added = streams[streams.length - 1]
  if (streams.length > before && added instanceof PDFRef) page1.node.set(STAMP_KEY, added)

  return Buffer.from(await doc.save())
}
