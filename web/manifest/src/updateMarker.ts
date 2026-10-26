// Remembers, across the restart an install causes, which version was running
// when the operator pressed "Installieren". The page that loads after the
// restart compares it with the version now running: different means the update
// went in, the same means it was rolled back. localStorage, because the reload
// is a fresh page; wrapped, because a locked-down browser may refuse storage.

const KEY = 'tandem.updateFrom'
const OUTCOME_KEY = 'tandem.updateOutcome'

// How long a settled outcome is shown to any tab that loads. The restarted exe
// opens a tab of its own and the tab the operator watched reloads a moment
// later; both share this storage, and both must say what happened.
const OUTCOME_SHOWN_MS = 2 * 60 * 1000

export interface InstallOutcome {
  from: string
  to: string
}

export function rememberInstallFrom(version: string): void {
  try {
    window.localStorage.setItem(KEY, version)
    window.localStorage.removeItem(OUTCOME_KEY)
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

/** The install was refused before anything happened: nothing to settle. */
export function forgetInstall(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    // A stale marker only means a needless restart screen on the next load.
  }
}

/** Settles the restart: the marker becomes an outcome every tab can read. */
export function settleInstall(from: string, to: string): void {
  try {
    window.localStorage.removeItem(KEY)
    window.localStorage.setItem(OUTCOME_KEY, JSON.stringify({ from, to, at: Date.now() }))
  } catch {
    // Nothing to do: only this tab will show the note.
  }
}

/** The outcome of an install settled in the last two minutes, if any. */
export function recentOutcome(): InstallOutcome | null {
  try {
    const raw = window.localStorage.getItem(OUTCOME_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as { from?: unknown; to?: unknown; at?: unknown }
    if (typeof o.from !== 'string' || typeof o.to !== 'string' || typeof o.at !== 'number') {
      return null
    }
    if (Date.now() - o.at > OUTCOME_SHOWN_MS) return null
    return { from: o.from, to: o.to }
  } catch {
    return null
  }
}

/** The operator has read it: no further tab needs to say it again. */
export function dismissOutcome(): void {
  try {
    window.localStorage.removeItem(OUTCOME_KEY)
  } catch {
    // The note may show once more in another tab, nothing worse.
  }
}
