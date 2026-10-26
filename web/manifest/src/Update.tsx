import { useEffect, useState } from 'react'
import {
  checkForUpdate, installUpdate, reloadPage, restartFinished, startUpdateDownload,
} from './api'
import type { UpdateStatus } from './api'
import InstallDialog from './InstallDialog'
import { Markdown } from './markdown'
import { operatorNotes } from './releaseNotes'
import { rememberInstallFrom } from './updateMarker'

export interface UpdateProps {
  status: UpdateStatus
  /** Pull the status again — used after an action whose result is not pushed. */
  onRefresh: () => void
  /** An action that failed before this screen opened (the download started
   *  from the update prompt). */
  actionError?: string | null
  /** This page loaded right after an install that was rolled back. */
  rolledBack?: boolean
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000)

// After this long without the new server answering, the screen stops only
// waiting and says what to do. A normal restart is done well before it.
const RESTART_PATIENCE_S = 90

// Third line of defence, after the server's own 403 on the mutating routes and
// the sidebar hiding this screen unless `allowed` is true: a screen that can
// restart the server for the whole drop zone should not rely solely on its
// parent to keep a tablet from reaching it. The title covers a mouse; the
// visible note covers a tablet, which has no hover state to reveal a title.
const notAllowedTitle = 'Updates sind nur an dem Rechner möglich, auf dem Tandem läuft.'

function checkedAtText(iso: string | null): string {
  if (!iso) return 'noch nie'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'unbekannt'
  return d.toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })
}

// The two decisions and the restart between them, as the operator meets them.
const STEPS = ['Herunterladen', 'Installieren', 'Neustart'] as const

function stepOf(phase: UpdateStatus['phase']): number | null {
  switch (phase) {
    case 'available': case 'downloading': case 'verifying': case 'download-failed':
      return 0
    case 'ready':
      return 1
    case 'installing':
      return 2
    default:
      return null
  }
}

export default function Update({ status, onRefresh, actionError, rolledBack }: UpdateProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(actionError ?? null)
  const [confirmingInstall, setConfirmingInstall] = useState(false)
  const [waitedS, setWaitedS] = useState(0)

  // The server is being replaced under us. Nothing on this screen is worth
  // showing until the new one answers, and then only a fresh page is honest.
  // The first check runs right away (the restart may already be done by the
  // time this mounts) — only retries after a miss wait out the second. A
  // check only passes once a server answers that is no longer installing, so
  // the old one, still answering on its way out, never triggers the reload.
  useEffect(() => {
    if (status.phase !== 'installing') return
    let stopped = false
    let timer: number | undefined
    const poll = async () => {
      if (stopped) return
      const alive = await restartFinished()
      // The component may have unmounted (or left the `installing` phase)
      // while that request was in flight; cleanup only cancels the *next*
      // timer, so re-check here before acting on a stale result.
      if (stopped) return
      if (alive) {
        reloadPage()
        return
      }
      timer = window.setTimeout(poll, 1000)
    }
    void poll()
    return () => {
      stopped = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [status.phase])

  // Seconds since the restart began, shown so a wait reads as progress and
  // not as a hang.
  useEffect(() => {
    if (status.phase !== 'installing') return
    setWaitedS(0)
    const id = window.setInterval(() => setWaitedS((s) => s + 1), 1000)
    return () => window.clearInterval(id)
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

  function confirmInstall() {
    setConfirmingInstall(false)
    rememberInstallFrom(status.currentVersion)
    void run(installUpdate)
  }

  // downloadedBytes can transiently exceed totalBytes (e.g. a chunk race);
  // clamp so aria-valuenow never leaves the 0-100 range it advertises.
  const rawPercent =
    status.totalBytes > 0 ? Math.round((status.downloadedBytes / status.totalBytes) * 100) : 0
  const percent = Math.min(100, Math.max(0, rawPercent))

  const canCheck =
    status.allowed &&
    (status.phase === 'idle' || status.phase === 'up-to-date' || status.phase === 'check-failed')

  const step = stepOf(status.phase)
  const notes = status.notes ? operatorNotes(status.notes) : ''

  const restricted = !status.allowed && (
    status.phase === 'available' || status.phase === 'ready' ||
    status.phase === 'download-failed' || status.phase === 'install-failed'
  )

  return (
    <div className="update-screen">
      <h1>Update</h1>

      <dl className="update-versions">
        <dt>Installierte Version</dt>
        <dd>{status.currentVersion}</dd>
        <dt>Neueste Version</dt>
        <dd className={status.latestVersion && status.latestVersion !== status.currentVersion
          ? 'update-new-version' : undefined}>
          {status.latestVersion ?? 'unbekannt'}
        </dd>
        <dt>Zuletzt geprüft</dt>
        <dd>{checkedAtText(status.checkedAt)}</dd>
      </dl>

      {step !== null && (
        <ol className="update-steps" aria-label="Ablauf">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={i < step ? 'done' : i === step ? 'current' : undefined}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className="update-step-no" aria-hidden="true">{i + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}

      {error && <p className="error">{error}</p>}

      {status.phase === 'available' && (
        <div className="update-step">
          <button type="button" className="btn primary" disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle}
            onClick={() => void run(startUpdateDownload)}>
            Herunterladen
          </button>
          {status.allowed && (
            <p className="update-note">
              Der Download läuft im Hintergrund, der Betrieb geht normal weiter. Installiert
              wird erst in einem zweiten Schritt.
            </p>
          )}
        </div>
      )}

      {(status.phase === 'downloading' || status.phase === 'verifying') && (
        <div className="update-progress">
          <progress role="progressbar" max={100} value={percent}
            aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} />
          <p>
            {status.phase === 'verifying'
              ? 'Download fertig, wird geprüft…'
              : `${mb(status.downloadedBytes)} MB von ${mb(status.totalBytes)} MB (${percent} %)`}
          </p>
          <p className="update-note">Der Betrieb geht währenddessen normal weiter.</p>
        </div>
      )}

      {status.phase === 'ready' && (
        <div className="update-step">
          <button type="button" className="btn primary" disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle}
            onClick={() => setConfirmingInstall(true)}>
            Jetzt installieren und neu starten
          </button>
          {status.allowed && (
            <p className="update-note">
              Heruntergeladen und geprüft. Beim Installieren startet Tandem kurz neu.
            </p>
          )}
        </div>
      )}

      {status.phase === 'installing' && (
        <div className="update-restarting" role="status">
          <span className="update-spinner" aria-hidden="true" />
          <div>
            <p className="update-restarting-title">Tandem startet neu… ({waitedS} s)</p>
            {waitedS < RESTART_PATIENCE_S ? (
              <p>
                Das dauert meist nur einen Moment. Diese Seite lädt von selbst neu, sobald
                Tandem wieder läuft.
              </p>
            ) : (
              <p className="error">
                Das dauert länger als erwartet. Wenn Tandem nicht von selbst wieder erscheint,
                starte tandem.exe auf diesem Rechner neu.
              </p>
            )}
          </div>
        </div>
      )}

      {status.phase === 'download-failed' && (
        <div className="update-step">
          <p className="error">
            Der Download hat nicht geklappt. Prüfe die Internetverbindung und versuche es
            erneut.
          </p>
          {status.error && <p className="update-tech">Technische Meldung: {status.error}</p>}
          <button type="button" className="btn primary" disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle}
            onClick={() => void run(startUpdateDownload)}>
            Erneut versuchen
          </button>
        </div>
      )}

      {status.phase === 'install-failed' && (
        <div className="update-step">
          {rolledBack ? (
            <>
              <p className="error">
                Version {status.latestVersion ?? 'die neue Version'} ließ sich nicht starten.
                Tandem wurde neu gestartet und läuft wieder mit Version {status.currentVersion}.
              </p>
              <p className="update-note">
                Die Tablets verbinden sich von selbst wieder. Wer gerade eine Anmeldung
                ausgefüllt hat, muss sie neu beginnen. Am besten heute nicht erneut versuchen
                und die technische Meldung unten weitergeben.
              </p>
            </>
          ) : (
            <p className="error">
              Die Installation hat nicht geklappt. Die bisherige Version {status.currentVersion}{' '}
              läuft weiter.
            </p>
          )}
          {status.error && <p className="update-tech">Technische Meldung: {status.error}</p>}
          {/* The server installs only from `ready` (src/server/main.ts), so a
              second attempt starts with the download, and the button says so. */}
          {/* Quiet after a rollback: the screen just advised against another
              attempt today, and the loudest button should not say otherwise. */}
          <button type="button" className={rolledBack ? 'btn secondary' : 'btn primary'}
            disabled={busy || !status.allowed}
            title={status.allowed ? undefined : notAllowedTitle}
            onClick={() => void run(startUpdateDownload)}>
            Neu herunterladen
          </button>
        </div>
      )}

      {restricted && <p className="update-restricted">{notAllowedTitle}</p>}

      {status.phase === 'up-to-date' && <p>Dies ist bereits die aktuellste Version.</p>}

      {/* Informational-only phases: nothing to do here beyond checking again,
          so no `allowed` gating on the text — just an honest line. */}
      {status.phase === 'checking' && <p>Es wird gerade nach Updates gesucht…</p>}

      {status.phase === 'check-failed' && (
        <p>
          Die Prüfung auf Updates hat nicht geklappt. Das liegt an diesem Standort meist an
          einer fehlenden Internetverbindung, nicht an einem Fehler – der nächste Versuch
          läuft automatisch.
        </p>
      )}

      {status.phase === 'idle' && <p>Es wurde noch nicht auf Updates geprüft.</p>}

      {status.phase === 'disabled' && <p>Auf diesem Gerät sind Updates nicht verfügbar.</p>}

      {canCheck && (
        <button type="button" className="btn secondary" disabled={busy}
          onClick={() => void run(checkForUpdate)}>
          Jetzt prüfen
        </button>
      )}

      {/* Not while restarting: the notes are what the operator already chose,
          and below a restart message they only push it out of focus. */}
      {notes && status.phase !== 'installing' && (
        <section className="update-notes">
          <h2>Was neu ist</h2>
          <Markdown text={notes} />
        </section>
      )}

      {confirmingInstall && status.latestVersion && (
        <InstallDialog
          latestVersion={status.latestVersion}
          openToday={status.openToday}
          onConfirm={confirmInstall}
          onCancel={() => setConfirmingInstall(false)}
        />
      )}
    </div>
  )
}
