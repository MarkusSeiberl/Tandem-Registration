import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib'
import { embedFont } from './contractPdf'
import { formatEuro } from './payouts'
import type { JumpStats, MoneyStats } from './stats'

// The yearly report as a printable A4 document. Drawn on the server, like the
// contract and the certificate, so it looks the same whichever device asks and
// the browser's own print layout never decides where a page breaks.
//
// Dates and numbers are written by hand rather than via Intl: the packaged exe
// carries its own ICU data, and the strings must not depend on it.

const A4 = { width: 595.28, height: 841.89 }
const MARGIN = 42
const CONTENT = A4.width - 2 * MARGIN

const INK = rgb(0.17, 0.17, 0.2)
const MUTED = rgb(0.42, 0.42, 0.47)
const RULE = rgb(0.85, 0.85, 0.87)
const ACCENT = rgb(0.075, 0.478, 0.271)
const GHOST = rgb(0.6, 0.6, 0.64)

const MONTHS_SHORT = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const MONTHS_LONG = [
  'Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const AGE_GROUPS = ['< 18', '18–25', '26–35', '36–50', '51–65', '> 65']

/** '2026-04-11' -> '11. Apr' */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS_SHORT[m - 1]}`
}

/** '2026-04-11' -> '11. April' */
function longDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number)
  return `${d}. ${MONTHS_LONG[m - 1]}`
}

function oneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1).replace('.', ',')
}

function signed(n: number, unit: string): string {
  if (n === 0) return `±0 ${unit}`
  return `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}`
}

function change(now: number, before: number | null | undefined): string {
  if (before == null || before === 0) return ''
  return signed(Math.round(((now - before) / before) * 100), '%')
}

function pointsChange(part: number, whole: number, partBefore: number | null, wholeBefore: number | null): string {
  if (partBefore == null || !wholeBefore || !whole) return ''
  return signed(Math.round((part / whole) * 100 - (partBefore / wholeBefore) * 100), 'Pp.')
}

function share(part: number, whole: number): string {
  return whole === 0 ? '0 %' : `${Math.round((part / whole) * 100)} %`
}

const vouchers = (n: number) => `${n} ${n === 1 ? 'Gutschein' : 'Gutscheine'}`

/** The months a chart shows: every month with data, and at least April to October. */
function shownMonths(...series: (number[] | null | undefined)[]): number[] {
  const used = series.flatMap((s) => (s ?? []).flatMap((n, i) => (n > 0 ? [i] : [])))
  const from = Math.min(3, ...used)
  const to = Math.max(9, ...used)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

/** The line under the title: when the season started and ended. */
export function seasonLine(s: JumpStats): string {
  return `Saison ${shortDate(s.firstDay!)} – ${shortDate(s.lastDay!)}`
}

interface Column {
  title: string
  width: number
  align?: 'left' | 'right'
}

class Writer {
  page!: PDFPage
  y = 0

  constructor(private doc: PDFDocument, private regular: PDFFont, private bold: PDFFont, private footer: string) {
    this.newPage()
  }

  newPage() {
    this.page = this.doc.addPage([A4.width, A4.height])
    this.y = A4.height - MARGIN
    this.page.drawText(this.footer, { x: MARGIN, y: MARGIN / 2, size: 8, font: this.regular, color: MUTED })
  }

  /** Starts a new page unless `height` more points still fit on this one. */
  ensure(height: number) {
    if (this.y - height < MARGIN) this.newPage()
  }

  text(t: string, x: number, y: number, size: number, opts: { bold?: boolean; color?: typeof INK; align?: 'left' | 'right' | 'center'; width?: number } = {}) {
    const font = opts.bold ? this.bold : this.regular
    const w = font.widthOfTextAtSize(t, size)
    let at = x
    if (opts.align === 'right') at = x + (opts.width ?? 0) - w
    if (opts.align === 'center') at = x + ((opts.width ?? 0) - w) / 2
    this.page.drawText(t, { x: at, y, size, font, color: opts.color ?? INK })
  }

  /** Shortens `t` with an ellipsis until it fits into `width`. */
  fit(t: string, width: number, size: number, bold = false): string {
    const font = bold ? this.bold : this.regular
    if (font.widthOfTextAtSize(t, size) <= width) return t
    let s = t
    while (s.length > 1 && font.widthOfTextAtSize(`${s}…`, size) > width) s = s.slice(0, -1)
    return `${s}…`
  }

  title(t: string, sub: string[]) {
    this.text(t, MARGIN, this.y - 20, 20, { bold: true })
    this.y -= 26
    for (const line of sub) {
      this.text(line, MARGIN, this.y - 12, 10, { color: MUTED })
      this.y -= 15
    }
    this.y -= 8
  }

  heading(t: string, keepWith: number) {
    this.ensure(30 + keepWith)
    this.y -= 14
    this.text(t, MARGIN, this.y - 12, 12.5, { bold: true, color: ACCENT })
    this.y -= 18
  }

  note(t: string) {
    this.ensure(14)
    this.text(t, MARGIN, this.y - 10, 9, { color: MUTED })
    this.y -= 14
  }

  table(columns: Column[], rows: string[][]) {
    const rowHeight = 16
    const header = () => {
      let x = MARGIN
      for (const c of columns) {
        this.text(c.title, x, this.y - 11, 8.5, { bold: true, color: MUTED, align: c.align, width: c.width })
        x += c.width
      }
      this.y -= rowHeight
      this.page.drawLine({ start: { x: MARGIN, y: this.y + 3 }, end: { x: MARGIN + CONTENT, y: this.y + 3 }, thickness: 0.6, color: RULE })
    }
    this.ensure(rowHeight * Math.min(rows.length + 1, 4))
    header()
    for (const row of rows) {
      if (this.y - rowHeight < MARGIN) {
        this.newPage()
        header()
      }
      let x = MARGIN
      row.forEach((cell, i) => {
        const c = columns[i]
        this.text(this.fit(cell, c.width - 6, 9.5, i === 0), x, this.y - 11, 9.5, { bold: i === 0, align: c.align, width: c.width })
        x += c.width
      })
      this.y -= rowHeight
      this.page.drawLine({ start: { x: MARGIN, y: this.y + 3 }, end: { x: MARGIN + CONTENT, y: this.y + 3 }, thickness: 0.3, color: RULE })
    }
  }

  /** Columns with the value on top; last year, when given, as an outline behind each bar. */
  bars(labels: string[], values: number[], previous: number[] | null, format: (n: number) => string = String) {
    const height = 110
    this.ensure(height + 34)
    const top = this.y - 14
    const base = top - height
    const max = Math.max(1, ...values, ...(previous ?? []))
    const slot = CONTENT / labels.length
    const barWidth = Math.min(34, slot * 0.6)

    this.page.drawLine({ start: { x: MARGIN, y: base }, end: { x: MARGIN + CONTENT, y: base }, thickness: 0.6, color: RULE })
    labels.forEach((label, i) => {
      const x = MARGIN + i * slot + (slot - barWidth) / 2
      if (previous && previous[i] > 0) {
        this.page.drawRectangle({
          x: x - 3, y: base, width: barWidth + 6, height: (previous[i] / max) * height,
          borderColor: GHOST, borderWidth: 0.8, borderDashArray: [2, 2],
        })
      }
      const h = (values[i] / max) * height
      if (h > 0) this.page.drawRectangle({ x, y: base, width: barWidth, height: h, color: ACCENT })
      if (values[i] > 0) {
        this.text(format(values[i]), x - 10, base + h + 3, 8, { align: 'center', width: barWidth + 20 })
      }
      this.text(label, MARGIN + i * slot, base - 11, 8.5, { color: MUTED, align: 'center', width: slot })
    })
    this.y = base - 18
  }

  key(year: number, before: number) {
    this.ensure(14)
    const y = this.y - 8
    this.page.drawRectangle({ x: MARGIN, y, width: 10, height: 7, color: ACCENT })
    this.text(String(year), MARGIN + 14, y, 8.5, { color: MUTED })
    this.page.drawRectangle({ x: MARGIN + 50, y, width: 10, height: 7, borderColor: GHOST, borderWidth: 0.8, borderDashArray: [2, 2] })
    this.text(String(before), MARGIN + 64, y, 8.5, { color: MUTED })
    this.y -= 16
  }
}

function comparisonLine(s: JumpStats): string | null {
  if (!s.comparedTo) return null
  const { year, asOf } = s.comparedTo
  return asOf ? `Vergleich: ${year} bis ${longDate(`${year}-${asOf}`)}` : `Vergleich: ${year}`
}

function shareRows(parts: { label: string; value: number }[], format: (n: number) => string = String): string[][] {
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  return parts.map((p) => [p.label, format(p.value), share(p.value, total)])
}

const SHARE_COLUMNS = (title: string, valueTitle: string): Column[] => [
  { title, width: CONTENT - 180 },
  { title: valueTitle, width: 100, align: 'right' },
  { title: 'Anteil', width: 80, align: 'right' },
]

/**
 * The yearly report as a PDF. `money` is only passed for the manifest PC; the
 * route decides that, this function just draws what it is given.
 */
export async function statsPdf(s: JumpStats, money: MoneyStats | null, createdOn: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.setTitle(`Jahresbericht ${s.year}`)
  const regular = await embedFont(doc, 'regular')
  const bold = await embedFont(doc, 'bold')
  const w = new Writer(doc, regular, bold, `Jahresbericht ${s.year} · erstellt am ${createdOn.split('-').reverse().join('.')}`)

  w.title(`Jahresbericht ${s.year}`, s.tandems > 0 ? [seasonLine(s)] : [])

  if (s.tandems === 0) {
    w.note(`Keine Tandems in ${s.year}.`)
    return Buffer.from(await doc.save())
  }

  const p = s.previous
  const kpiColumns: Column[] = [
    { title: 'Kennzahl', width: CONTENT - 300 },
    { title: String(s.year), width: 100, align: 'right' },
    { title: p && s.comparedTo ? String(s.comparedTo.year) : '', width: 100, align: 'right' },
    { title: p ? 'Veränderung' : '', width: 100, align: 'right' },
  ]
  const average = s.tandems / s.jumpDays
  const averageBefore = p && p.jumpDays > 0 ? p.tandems / p.jumpDays : null
  w.heading('Kennzahlen', 90)
  w.table(kpiColumns, [
    ['Tandems', String(s.tandems), p ? String(p.tandems) : '', change(s.tandems, p?.tandems)],
    ['Sprungtage', String(s.jumpDays), p ? String(p.jumpDays) : '', change(s.jumpDays, p?.jumpDays)],
    ['Ø pro Sprungtag', oneDecimal(average), averageBefore !== null ? oneDecimal(averageBefore) : '', change(average, averageBefore)],
    ['Mit Video (+Foto)', share(s.video, s.tandems), p ? share(p.video, p.tandems) : '',
      pointsChange(s.video, s.tandems, p?.video ?? null, p?.tandems ?? null)],
    ['Mit Gutschein', share(s.voucher, s.tandems), p ? share(p.voucher, p.tandems) : '',
      pointsChange(s.voucher, s.tandems, p?.voucher ?? null, p?.tandems ?? null)],
  ])
  // A running season is compared only up to the same day last year; the
  // document must say so, or the earlier column reads as a whole season.
  const compare = comparisonLine(s)
  if (compare) w.note(compare)

  const months = shownMonths(s.months, p?.months)
  w.heading('Tandems pro Monat', 140)
  w.bars(months.map((m) => MONTHS_SHORT[m]), months.map((m) => s.months[m]), p ? months.map((m) => p.months[m]) : null)
  if (s.comparedTo) w.key(s.year, s.comparedTo.year)

  w.heading('Gebuchte Leistung', 60)
  w.table(SHARE_COLUMNS('Leistung', 'Tandems'), shareRows([
    { label: 'nur Sprung', value: s.services.none },
    { label: 'Sprung+Video', value: s.services.video },
    { label: 'Sprung+Video+Foto', value: s.services.video_photo },
  ]))

  const compared = s.comparedTo !== null
  w.heading('Tandemmaster', 60)
  w.table([
    { title: 'Name', width: CONTENT - 330 },
    { title: 'Tandems', width: 60, align: 'right' },
    { title: 'Tage', width: 60, align: 'right' },
    { title: 'Bester Tag', width: 70, align: 'right' },
    { title: 'Mit Video', width: 70, align: 'right' },
    { title: compared ? 'Veränderung' : '', width: 70, align: 'right' },
  ], s.masters.map((m) => [
    m.name ?? 'ohne Tandemmaster', String(m.tandems), String(m.days), String(m.bestDay.count),
    share(m.video, m.tandems), compared ? change(m.tandems, m.previous) : '',
  ]))

  w.heading('Kameraflieger', 40)
  if (s.flyers.length === 0) w.note('Keine Video-Buchungen.')
  else {
    w.table([
      { title: 'Name', width: CONTENT - 240 },
      { title: 'Sprünge', width: 70, align: 'right' },
      { title: 'Tage', width: 70, align: 'right' },
      { title: 'Davon mit Foto', width: 100, align: 'right' },
    ], s.flyers.map((f) => [f.name ?? 'ohne Kameraflieger', String(f.jumps), String(f.days), String(f.videoPhoto)]))
  }

  w.heading('Wochentage', 140)
  w.bars(WEEKDAYS, s.weekdays.map((d) => d.tandems), null)

  w.heading('Gäste nach Alter', 140)
  w.bars(AGE_GROUPS, s.ageGroups, null)

  w.heading('Gäste nach Geschlecht', 60)
  w.table(SHARE_COLUMNS('Geschlecht', 'Gäste'), shareRows([
    { label: 'weiblich', value: s.gender.female },
    { label: 'männlich', value: s.gender.male },
    { label: 'divers', value: s.gender.diverse },
  ]))

  if (s.cities.length > 0) {
    w.heading('Woher die Gäste kommen', 60)
    w.table([
      { title: 'Ort', width: CONTENT - 100 },
      { title: 'Gäste', width: 100, align: 'right' },
    ], s.cities.map((c) => [c.city, String(c.count)]))
  }

  if (money) drawMoney(w, money, months)

  return Buffer.from(await doc.save())
}

function drawMoney(w: Writer, m: MoneyStats, months: number[]) {
  w.newPage()
  w.title('Umsatz', ['Vertraulich – nur am Manifest-PC erstellt.'])
  const p = m.previous
  w.heading('Kennzahlen', 50)
  w.table([
    { title: 'Kennzahl', width: CONTENT - 300 },
    { title: String(m.year), width: 100, align: 'right' },
    { title: p && m.comparedTo ? String(m.comparedTo.year) : '', width: 100, align: 'right' },
    { title: p ? 'Veränderung' : '', width: 100, align: 'right' },
  ], [
    ['Kassiert', formatEuro(m.collected), p ? formatEuro(p.collected) : '', change(m.collected, p?.collected)],
    ['Gutscheinwert', formatEuro(m.voucherValue), p ? formatEuro(p.voucherValue) : '', change(m.voucherValue, p?.voucherValue)],
  ])

  w.heading('Kassiert pro Monat', 140)
  const euros = (n: number) => `${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')} €`
  w.bars(months.map((i) => MONTHS_SHORT[i]), months.map((i) => m.months[i]), p ? months.map((i) => p.months[i]) : null, euros)
  if (m.comparedTo) w.key(m.year, m.comparedTo.year)

  const tills = [
    { label: 'Bar', value: m.tills.cash },
    { label: 'Karte', value: m.tills.card },
    { label: 'nicht erfasst', value: m.tills.unrecorded },
  ].filter((t) => t.value !== 0)
  if (tills.length > 0) {
    w.heading('Kasse', 60)
    w.table(SHARE_COLUMNS('Kasse', 'Betrag'), shareRows(tills, formatEuro))
  }

  const v = m.vouchers
  if (v.count + v.unknown > 0) {
    w.heading('Gutscheine', 60)
    if (v.count > 0) {
      w.table([
        { title: '', width: CONTENT - 120 },
        { title: 'Betrag', width: 120, align: 'right' },
      ], [
        ['Leistungswert', formatEuro(v.value)],
        ['Kaufpreis', formatEuro(v.paid)],
      ])
      const difference = v.value - v.paid
      const verdict = difference > 0
        ? `${formatEuro(difference)} mehr Leistung als bezahlt`
        : difference < 0 ? `${formatEuro(-difference)} weniger Leistung als bezahlt` : 'Leistung wie bezahlt'
      w.note(`${vouchers(v.count)} · ${verdict}`)
    }
    if (v.unknown > 0) {
      w.note(`${vouchers(v.unknown)} ohne bekannten Kaufpreis ${v.unknown === 1 ? 'ist' : 'sind'} nicht enthalten.`)
    }
  }
}

