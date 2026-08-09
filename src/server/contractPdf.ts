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
// signed and written to disk. It goes in the empty strip above the template's
// header, at the top-left, where the operator sees it without unfolding the page.
//
// The band was measured, not guessed: the template draws its text as vector
// paths, and the topmost of them sits at y≈802 (rising to roughly y≈810 for the
// glyphs themselves). Nothing at all is drawn above that. `clear` therefore
// starts at 814 — far enough that the white box cannot eat into the header, and
// far enough below the sheet edge (cap height reaches y≈826, some 16pt / 5.7mm
// down) to survive a printer's unprintable margin.
//
// `clear` is drawn white before the text: without it a corrected number would be
// printed over the old one, and a deleted number would stay on the paper forever.
// Erasing nothing but its own previous stamp matters here, because the signed PDF
// cannot be rebuilt — the signature is not stored.
const VOUCHER_STAMP = {
  clear: { x: 36, y: 814, width: 240, height: 16 },
  text: { x: 40, y: 818, size: 11 },
}

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
// can drop it instead of layering a second one on top. Painting white over the
// old number would only hide it: the text would stay in the file, selectable and
// copyable, and a contract would carry two voucher numbers with one of them
// invisible. A private key in the page dictionary is ignored by every reader.
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

  // Still drawn even though the old stream is gone: it also covers a stamp left
  // by a version of this code that predates the key above.
  page1.drawRectangle({
    x: VOUCHER_STAMP.clear.x,
    y: VOUCHER_STAMP.clear.y,
    width: VOUCHER_STAMP.clear.width,
    height: VOUCHER_STAMP.clear.height,
    color: rgb(1, 1, 1),
  })

  const trimmed = voucherNumber?.trim() ?? ''
  if (trimmed.length > 0) {
    page1.drawText(`Gutschein-Nr.: ${trimmed}`, {
      x: VOUCHER_STAMP.text.x,
      y: VOUCHER_STAMP.text.y,
      size: VOUCHER_STAMP.text.size,
      font,
      color: rgb(0, 0, 0),
    })
  }

  // pdf-lib appends the operators above to a content stream it registers on the
  // first draw call, so the stream just added is the last one on the page.
  const streams = contentStreamRefs(page1)?.asArray() ?? []
  const added = streams[streams.length - 1]
  if (added instanceof PDFRef) page1.node.set(STAMP_KEY, added)

  return Buffer.from(await doc.save())
}
