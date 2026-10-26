// Remembers, across the restart an install causes, which version was running
// when the operator pressed "Installieren". The page that loads after the
// restart compares it with the version now running: different means the update
// went in, the same means it was rolled back. localStorage, because the reload
// is a fresh page; wrapped, because a locked-down browser may refuse storage.

const KEY = 'tandem.updateFrom'

export function rememberInstallFrom(version: string): void {
  try {
    window.localStorage.setItem(KEY, version)
  } catch {
    // Without storage the only loss is the note after the restart.
  }
}

/** The remembered version, left in place: a page that loads while the restart
 *  is still under way has nothing to compare yet. */
export function peekInstallFrom(): string | null {
  try {
    return window.localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Removed once the outcome has been shown, so the note shows once. */
export function clearInstallFrom(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // Nothing to do: the note may show once more, nothing worse.
  }
}
