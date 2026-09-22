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

// Check if a version string is valid: all parts must be numeric.
// '1.2.3' is valid; '1.2.0-beta' is not.
function isValidVersion(version: string): boolean {
  const parts = version.split('.')
  return parts.length > 0 && parts.every(part => /^\d+$/.test(part))
}

export class UpdateState {
  private status: UpdateStatus
  private listeners: ((s: UpdateStatus) => void)[] = []
  private promptArmed = false
  /** The release the download and install steps work from. */
  release: Release | null = null

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

  beginCheck(): void {
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
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    // compareVersions answers null when it cannot compare the two. The release
    // tag is already gated by parseRelease's regex; the other operand is
    // APP_VERSION out of package.json and is not. A malformed local version is
    // a build mistake, not something the operator can fix at the landing site,
    // so it must never take the jump day down or strand the state in
    // 'checking' — it becomes an ordinary failed check, loud in the log.
    if (!isValidVersion(this.status.currentVersion)) {
      console.error(
        `[tandem] Versionsvergleich nicht möglich: "${release.version}" gegen ` +
          `"${this.status.currentVersion}".`,
      )
      this.release = null
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    const newer = compareVersions(release.version, this.status.currentVersion)
    if (newer === null) {
      console.error(
        `[tandem] Versionsvergleich nicht möglich: "${release.version}" gegen ` +
          `"${this.status.currentVersion}".`,
      )
      this.release = null
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    if (newer <= 0) {
      this.release = null
      this.patch({ phase: 'up-to-date', latestVersion: release.version, checkedAt })
      return
    }
    this.release = release
    if (isStartup) this.promptArmed = true
    this.patch({
      phase: 'available', latestVersion: release.version, notes: release.notes,
      checkedAt, error: null, downloadedBytes: 0, totalBytes: 0,
    })
  }

  markPromptSeen(): void {
    this.promptArmed = false
  }

  fail(phase: UpdatePhase, message: string): void {
    this.patch({ phase, error: message })
  }
}
