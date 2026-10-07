import { PDFDocument, rgb } from 'pdf-lib'
import { embedFont } from './contractPdf'

export interface UrkundeData {
  name: string
  // ISO `YYYY-MM-DD`, as stored in registrations.jump_date.
  jumpDate: string
}

// The two blanks on assets/Urkunde.pdf (A4 portrait, 595x842 pt) are plain
// drawn lines, not form fields, so filling means drawing text above them.
// Measured off the template, in pdf-lib's bottom-left origin.
export const NAME_LINE = { x1: 151.39, x2: 560.89, y: 427.04 }
export const DATE_LINE = { x1: 270.71, x2: 376.17, y: 167.42 }

const NAME_SIZE = 24
// Keeps a long name from touching the ends of the line.
const NAME_PADDING = 10
// The date matches the 12 pt "Flugplatz Freistadt, am" printed before it.
const DATE_SIZE = 12

function centredX(line: { x1: number; x2: number }, width: number): number {
  return (line.x1 + line.x2) / 2 - width / 2
}

export async function fillUrkundePdf(
  templateBytes: Uint8Array,
  data: UrkundeData
): Promise<Buffer> {
  const doc = await PDFDocument.load(templateBytes)
  const [page] = doc.getPages()
  const bold = await embedFont(doc, 'bold')
  const regular = await embedFont(doc, 'regular')
  const black = rgb(0, 0, 0)

  const maxNameWidth = NAME_LINE.x2 - NAME_LINE.x1 - 2 * NAME_PADDING
  const fullWidth = bold.widthOfTextAtSize(data.name, NAME_SIZE)
  const nameSize = fullWidth > maxNameWidth ? NAME_SIZE * (maxNameWidth / fullWidth) : NAME_SIZE
  page.drawText(data.name, {
    x: centredX(NAME_LINE, bold.widthOfTextAtSize(data.name, nameSize)),
    y: NAME_LINE.y + 8,
    size: nameSize,
    font: bold,
    color: black,
  })

  const date = data.jumpDate.split('-').reverse().join('.')
  page.drawText(date, {
    x: centredX(DATE_LINE, regular.widthOfTextAtSize(date, DATE_SIZE)),
    y: DATE_LINE.y + 2,
    size: DATE_SIZE,
    font: regular,
    color: black,
  })

  return Buffer.from(await doc.save())
}
