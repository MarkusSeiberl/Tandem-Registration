// Money in the closing dialog always shows its cents: it is read against the
// coins in the till, where "5 €" and "5,00 €" are not the same certainty.
export function formatMoney(value: number): string {
  return `${value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/\s/g, '.')} €`
}

/** A difference with its direction: "+5,00 €", "−5,00 €", "0,00 €". */
export function formatSigned(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${formatMoney(Math.abs(value))}`
}

/** "Sonntag, 8. November 2026" for a YYYY-MM-DD jump date. */
export function formatLongDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d, 12).toLocaleDateString('de-AT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

/** "8.11., 18:42" for an ISO timestamp, in local time. */
export function formatClosedAt(iso: string): string {
  const at = new Date(iso)
  const time = at.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
  return `${at.getDate()}.${at.getMonth() + 1}., ${time}`
}

export const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)
