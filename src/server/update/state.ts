import { compareVersions } from './github'
import type { Release } from './github'

export type UpdatePhase =
  | 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'check-failed'
  | 'available' | 'downloading' | 'verifying' | 'ready'
  | 'download-failed' | 'installing' | 'install-failed'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  notes: string | null
  downloadedBytes: number
  totalBytes: number
  /** Only ever set for something the operator can act on. Never for a lost network. */
  error: string | null
  checkedAt: string | null
}

export class UpdateState {
  private status: UpdateStatus
  private listeners: ((s: UpdateStatus) => void)[] = []
  private promptArmed = false
  private _release: Release | null = null

  /** The release the download and install steps work from. */
  get release(): Release | null {
    return this._release
  }

  constructor(currentVersion: string, phase: UpdatePhase = 'idle') {
    this.status = {
      phase, currentVersion, latestVersion: null, notes: null,
      downloadedBytes: 0, totalBytes: 0, error: null, checkedAt: null,
    }
  }

  get(): UpdateStatus {
    return { ...this.status }
  }

  get promptPending(): boolean {
    return this.promptArmed
  }

  onChange(listener: (s: UpdateStatus) => void): void {
    this.listeners.push(listener)
  }

  patch(fields: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...fields }
    for (const l of this.listeners) l(this.get())
  }

  /**
   * True while the screen reports a rolled-back install. After a rollback the
   * restarted old version reads the failure marker, and a second later its
   * startup check finds the very release that just failed. A check must not erase the
   * only explanation the operator gets — only a current installation does.
   */
  private get holdsInstallFailure(): boolean {
    return this.status.phase === 'install-failed'
  }

  beginCheck(): void {
    if (this.holdsInstallFailure) return
    this.patch({ phase: 'checking' })
  }

  /**
   * `isStartup` decides one thing and one thing only: whether the manifest is
   * allowed to open a modal about this find. The hourly check passes false, so
   * a release published at noon lights the sidebar and nothing else.
   */
  foundRelease(release: Release | null, isStartup: boolean): void {
    const checkedAt = new Date().toISOString()
    if (!release) {
      this.forget()
      if (this.holdsInstallFailure) return this.patch({ checkedAt })
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    // compareVersions answers null when it cannot compare the two. The release
    // tag is already gated by parseRelease's regex; the other operand is
    // APP_VERSION out of package.json and is not. A malformed local version is
    // a build mistake, not something the operator can fix at the landing site,
    // so it must never take the jump day down or strand the state in
    // 'checking' — it becomes an ordinary failed check, loud in the log.
    const newer = compareVersions(release.version, this.status.currentVersion)
    if (newer === null) {
      console.error(
        `[tandem] Versionsvergleich nicht möglich: "${release.version}" gegen ` +
          `"${this.status.currentVersion}".`,
      )
      this.forget()
      if (this.holdsInstallFailure) return this.patch({ checkedAt })
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    if (newer <= 0) {
      this.forget()
      this.patch({ phase: 'up-to-date', latestVersion: release.version, checkedAt, error: null })
      return
    }
    this._release = release
    if (this.holdsInstallFailure) {
      // Keep phase and error; hold the release so "Erneut versuchen" can
      // download it, and arm no dialog over the report.
      this.patch({ latestVersion: release.version, notes: release.notes, checkedAt })
      return
    }
    if (isStartup) this.promptArmed = true
    this.patch({
      phase: 'available', latestVersion: release.version, notes: release.notes,
      checkedAt, error: null, downloadedBytes: 0, totalBytes: 0,
    })
  }

  markPromptSeen(): void {
    this.promptArmed = false
  }

  /**
   * There is nothing installable any more. Drops the handle the downloader
   * works from AND any armed dialog: leaving the dialog armed while the
   * release is gone would open a modal offering a version the download step
   * then silently refuses to fetch — a dead end with no feedback.
   */
  private forget(): void {
    this._release = null
    this.promptArmed = false
  }

  fail(phase: UpdatePhase, message: string): void {
    this.patch({ phase, error: message })
  }
}
