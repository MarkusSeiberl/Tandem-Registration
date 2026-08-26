// Mirror of today() in src/server/day.ts, and it has to stay one: the server
// files a registration under its own local day, and a manifest computing the
// day in UTC would open on yesterday between local midnight and 02:00 — showing
// an empty list while guests are registering, and hiding the reprice button
// because the day on screen is not the day the server calls today.
export function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const KEY = 'manifest.date'

/**
 * The day the manifest is showing.
 *
 * Kept in sessionStorage rather than only in React state: the list used to be
 * unmounted by every trip to Stammdaten, Einstellungen or a registration's
 * detail, and came back on today — so anyone working through yesterday's jumps
 * had to pick the date again after every look at something else. A reload of
 * the window did the same.
 *
 * Session, not local: a manifest opened fresh the next morning should start on
 * that morning, not on whatever day was last looked at.
 */
export function storedDate(): string {
  try {
    const stored = sessionStorage.getItem(KEY)
    return stored && /^\d{4}-\d{2}-\d{2}$/.test(stored) ? stored : today()
  } catch {
    // Private mode, or storage switched off: the day simply does not survive.
    return today()
  }
}

export function rememberDate(date: string): void {
  try {
    sessionStorage.setItem(KEY, date)
  } catch {
    // See above — remembering is a convenience, never a requirement.
  }
}
