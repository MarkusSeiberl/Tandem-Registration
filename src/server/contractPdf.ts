import { PDFArray, PDFDocument, PDFName, PDFRef, StandardFonts, rgb } from 'pdf-lib'

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

// The voucher number is added later than everything else — the manifest only
// learns it when the guest hands the voucher over, long after the contract was
// signed and written to disk. It goes on the blank line at the top-left, where
// the operator sees it without unfolding the page.
//
// Bare number, no label: the line it sits on already says what it is.
//
// No white box either, which makes removing the previous content stream (see
// STAMP_KEY below) the *only* thing standing between a corrected number and a
// contract showing two of them. That mechanism is not an optimisation here — it
// is the erase.
const VOUCHER_STAMP = { x: 105, y: 796, size: 11 }

const PAGE2 = {
  ort: { x: 85, y: 82 },
  // The Datum blank is only ~60pt wide (right after the "Datum:" label,
  // before "Unterschrift:" starts around x=300) — too narrow for a full
  // dd.mm.yyyy date at 10pt, hence the smaller size here.
  datum: { x: 220, y: 82, size: 9 },
  signature: { x: 440, y: 84, width: 90, height: 36 },
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
  const font = await doc.embedFont(StandardFonts.Helvetica)
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
// would show both numbers, overprinted. A private key in the page dictionary is
// ignored by every reader.
const STAMP_KEY = PDFName.of('TandemVoucherStamp')

function contentStreamRefs(page: ReturnType<PDFDocument['getPages']>[number]): PDFArray | undefined {
  const contents = page.node.get(PDFName.of('Contents'))
  const resolved = contents instanceof PDFRef ? page.node.context.lookup(contents) : contents
  return resolved instanceof PDFArray ? resolved : undefined
}

// Stamps (or clears) the voucher number on an already-generated contract PDF.
// Re-stampable by design: the previous stamp is removed first, so calling this
// repeatedly with different numbers leaves exactly one number in the document,
// and an empty `voucherNumber` leaves none.
export async function stampVoucherNumber(
  pdfBytes: Uint8Array,
  voucherNumber: string | null
): Promise<Buffer> {
  const doc = await PDFDocument.load(pdfBytes)
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
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

  const trimmed = voucherNumber?.trim() ?? ''
  if (trimmed.length > 0) {
    page1.drawText(trimmed, {
      x: VOUCHER_STAMP.x,
      y: VOUCHER_STAMP.y,
      size: VOUCHER_STAMP.size,
      font,
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
