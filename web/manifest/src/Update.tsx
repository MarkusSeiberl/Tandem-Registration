import { useEffect, useState } from 'react'
import { installUpdate, reloadPage, serverAlive, startUpdateDownload } from './api'
import type { UpdateStatus } from './api'
import { Markdown } from './markdown'

export interface UpdateProps {
  status: UpdateStatus
  /** Pull the status again — used after an action whose result is not pushed. */
  onRefresh: () => void
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000)

// Third line of defence, after the server's own 403 on the mutating routes and
// the sidebar hiding this screen unless `allowed` is true: a screen that can
// restart the server for the whole drop zone should not rely solely on its
// parent to keep a tablet from reaching it. The title covers a mouse; the
// visible hint covers a tablet, which has no hover state to reveal a title.
const notAllowedTitle = 'Updates sind nur an dem Rechner möglich, auf dem Tandem läuft.'

export default function Update({ status, onRefresh }: UpdateProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The server is being replaced under us. Nothing on this screen is worth
  // showing until the new one answers, and then only a fresh page is honest.
  // The first check runs right away (the restart may already be done by the
  // time this mounts) — only retries after a miss wait out the second.
  useEffect(() => {
    if (status.phase !== 'installing') return
    let stopped = false
    let timer: number | undefined
    const poll = async () => {
      if (stopped) return
      if (await serverAlive()) {
        reloadPage()
        return
      }
      if (!stopped) timer = window.setTimeout(poll, 1000)
    }
    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [status.phase])

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function handleInstall() {
    const open = status.openToday
    const openLine =
      open === 0
        ? ''
        : open === 1
          ? '\n\nEin Tandem von heute ist noch offen.'
          : `\n\n${open} Tandems von heute sind noch offen.`
    const confirmed = window.confirm(
      `Jetzt auf Version ${status.latestVersion} aktualisieren?\n\n` +
        'Das Programm startet dabei neu. Gäste-Anmeldung und Manifest sind auf ' +
        'allen Geräten für einen Moment nicht erreichbar.' +
        openLine,
    )
    if (!confirmed) return
    void run(installUpdate)
  }

  const percent =
    status.totalBytes > 0 ? Math.round((status.downloadedBytes / status.totalBytes) * 100) : 0

  return (
    <div className="update-screen">
      <h2>Update</h2>

      <dl className="update-versions">
        <dt>Installierte Version</dt>
        <dd>{status.currentVersion}</dd>
        <dt>Neueste Version</dt>
        <dd>{status.latestVersion ?? 'unbekannt'}</dd>
      </dl>

      {(error || status.error) && <p className="error">{error ?? status.error}</p>}

      {status.phase === 'available' && (
        <>
          <button type="button" className="btn primary" disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle}
            onClick={() => void run(startUpdateDownload)}>
            Herunterladen
          </button>
          {!status.allowed && <p className="hint">{notAllowedTitle}</p>}
        </>
      )}

      {(status.phase === 'downloading' || status.phase === 'verifying') && (
        <div className="update-progress">
          <progress role="progressbar" max={100} value={percent}
            aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} />
          <p>
            {mb(status.downloadedBytes)} MB von {mb(status.totalBytes)} MB ({percent} %)
          </p>
        </div>
      )}

      {status.phase === 'ready' && (
        <>
          <button type="button" className="btn primary" disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle} onClick={handleInstall}>
            Jetzt installieren und neu starten
          </button>
          {!status.allowed && <p className="hint">{notAllowedTitle}</p>}
        </>
      )}

      {status.phase === 'installing' && <p className="update-restarting">Tandem startet neu…</p>}

      {(status.phase === 'download-failed' || status.phase === 'install-failed') && (
        <>
          <button type="button" className="btn secondary" disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle}
            onClick={() => void run(startUpdateDownload)}>
            Erneut versuchen
          </button>
          {!status.allowed && <p className="hint">{notAllowedTitle}</p>}
        </>
      )}

      {status.phase === 'up-to-date' && <p>Dies ist bereits die aktuellste Version.</p>}

      {status.notes && (
        <section className="update-notes">
          <h3>Was neu ist</h3>
          <Markdown text={status.notes} />
        </section>
      )}
    </div>
  )
}
