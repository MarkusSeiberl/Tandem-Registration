import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

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
