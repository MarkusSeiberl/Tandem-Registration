export function today(): string {
  return new Date().toISOString().slice(0, 10)
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
