/**
 * Which calendar day it is, locally.
 *
 * The club is in Austria (UTC+1/+2), so between local midnight and 02:00 the
 * UTC date is still *yesterday*. `toISOString().slice(0, 10)` therefore files a
 * registration taken just after midnight under the previous jump day: it is
 * priced from that day's frozen table, it does not show up on the day the
 * operator is looking at, and the reprice button refuses it because the route
 * only moves today. The contract PDF would carry the wrong Datum as well.
 *
 * A jump day is a day at the drop zone, never a day in UTC, so every "what day
 * is it" in the server comes from here.
 */
export function isoDay(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function today(): string {
  return isoDay(new Date())
}
