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

/** The remembered version, removed in the same step so the note shows once. */
export function takeInstallFrom(): string | null {
  try {
    const v = window.localStorage.getItem(KEY)
    if (v !== null) window.localStorage.removeItem(KEY)
    return v
  } catch {
    return null
  }
}
