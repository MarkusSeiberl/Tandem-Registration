import { useEffect, useState } from 'react'
import List from './List'
import Detail from './Detail'
import Stammdaten from './Stammdaten'
import Settings from './Settings'
import Update from './Update'
import UpdateDialog from './UpdateDialog'
import BrandMark from './BrandMark'
import Urkunde from './Urkunde'
import type { Registration } from './api'
import { shutdownAllowed, shutdownApp } from './api'
import { getUpdateStatus, markUpdatePromptSeen, startUpdateDownload } from './api'
import type { UpdatePhase, UpdateStatus } from './api'
import { useUpdateEvents } from './useEvents'
import { rememberDate, storedDate } from './date'

type View = 'list' | 'detail' | 'stammdaten' | 'settings' | 'update'

function App() {
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<Registration | null>(null)

  // Stopping the program. Only the machine the server runs on may do it — the
  // manifest has no login and every device on the club WLAN can open it, so the
  // server decides and this only draws what it says.
  const [canShutdown, setCanShutdown] = useState(false)
  const [shuttingDown, setShuttingDown] = useState(false)
  const [closed, setClosed] = useState(false)
  const [shutdownError, setShutdownError] = useState<string | null>(null)

  useEffect(() => {
    shutdownAllowed()
      .then((r) => setCanShutdown(r.allowed))
      .catch(() => {
        // Unreachable or an older server: leave the button off rather than
        // offering an action that cannot work.
      })
  }, [])

  // The update status is fetched once and then pushed: a 114 MB download would
  // otherwise cost one request per percent, from every open manifest.
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    getUpdateStatus()
      .then(setUpdate)
      .catch(() => {
        // An older server without the update routes. No entry, no dialog —
        // exactly what a server that cannot update itself should show.
      })
  }, [])

  useUpdateEvents(update?.allowed === true, (status) => {
    // The page usually loads before the startup check has run (the exe opens
    // the browser as soon as it listens, the check follows 5 s later), and the
    // frame that reports the find carries no promptPending. Ask the GET route
    // once when a release turns up, or the dialog could never open.
    // useUpdateEvents always calls the latest callback, so `update` is current.
    if (status.phase === 'available' && update?.phase !== 'available') refreshUpdate()
    // The broadcast (src/server/update/state.ts UpdateState.patch, sent via
    // src/server/index.ts) carries only the eight UpdateStatus fields — never
    // `allowed`, `promptPending` or `openToday`, which the GET route computes
    // per client (src/server/routes/update.ts). So `status` cannot actually
    // carry those three today. `allowed` is still pinned explicitly here as
    // belt-and-braces: if a future broadcast ever widened to the full
    // response, this is what stops a pushed frame from handing a tablet an
    // `allowed` it never earned.
    setUpdate((prev) => (prev ? { ...prev, ...status, allowed: prev.allowed } : prev))
  })

  function refreshUpdate() { void getUpdateStatus().then(setUpdate).catch(() => {}) }

  // Only while something is actually pending — and only where it can be acted on.
  const PENDING: UpdatePhase[] = [
    'available', 'downloading', 'verifying', 'ready', 'download-failed', 'install-failed',
  ]
  const showUpdateTab = update?.allowed === true && PENDING.includes(update.phase)

  const [promptDismissed, setPromptDismissed] = useState(false)
  const showPrompt =
    update?.allowed === true && update.promptPending && !promptDismissed &&
    update.latestVersion !== null &&
    // A download started from the update screen leaves promptPending set;
    // "download now?" makes no sense once one is under way or done.
    update.phase === 'available'

  function acceptUpdate() {
    setPromptDismissed(true)
    // Telling the server the dialog was shown is a courtesy, not a
    // precondition: the dialog is already closed locally via
    // `promptDismissed`. If the landing site is offline — entirely plausible
    // here — the only consequence of losing this is that the dialog can show
    // once more after the next server start, which is not worth surfacing to
    // the operator as an error.
    void markUpdatePromptSeen().catch(() => {})
    void startUpdateDownload().then(refreshUpdate).catch(() => {})
    setView('update')
  }

  function postponeUpdate() {
    setPromptDismissed(true)
    // See acceptUpdate: same courtesy call, same reason to swallow a failure.
    void markUpdatePromptSeen().catch(() => {})
  }

  async function handleShutdown() {
    const confirmed = window.confirm(
      `Tandem wirklich beenden?

Danach sind Gäste-Anmeldung und Manifest auf allen Geräten nicht mehr erreichbar, bis das Programm neu gestartet wird.`
    )
    if (!confirmed) return
    setShutdownError(null)
    setShuttingDown(true)
    try {
      await shutdownApp()
      setClosed(true)
    } catch (err) {
      setShutdownError(err instanceof Error ? err.message : 'Beenden fehlgeschlagen')
    } finally {
      setShuttingDown(false)
    }
  }

  // Held here, not in List: List is unmounted by every other tab and by opening
  // a registration, and a chosen day must outlive that.
  const [date, setDate] = useState(storedDate)

  function chooseDate(next: string) {
    setDate(next)
    rememberDate(next)
  }

  function openDetail(registration: Registration) {
    setSelected(registration)
    setView('detail')
  }

  function closeDetail() {
    setSelected(null)
    setView('list')
  }

  // The server this screen talks to is gone. Anything it still shows would be a
  // day's worth of numbers nobody can save or refresh, so it says the one true
  // thing instead.
  if (closed) {
    return (
      <div className="app-closed">
        <BrandMark size={42} />
        <h1>Tandem wurde beendet.</h1>
        <p>Dieses Fenster kann geschlossen werden.</p>
      </div>
    )
  }

  return (
    <>
      {/*
        The Urkunde print sheet lives OUTSIDE `.app-root` on purpose: `.app-root`
        carries `no-print` below, which under `@media print` is forced to
        `display: none`. A `display: none` ancestor hides its descendants
        unconditionally, so the print sheet must sit as a sibling, not a child,
        of the hidden app shell (see urkunde.css).
      */}
      {selected && <Urkunde registration={selected} />}

      <div className="app-root no-print">
        <nav className="sidebar">
          <div className="brand">
            <BrandMark size={26} />
            Tandem Manifest
          </div>
          <button
            type="button"
            className={view === 'list' || view === 'detail' ? 'tab active' : 'tab'}
            onClick={() => setView('list')}
          >
            Manifest
          </button>
          <button
            type="button"
            className={view === 'stammdaten' ? 'tab active' : 'tab'}
            onClick={() => setView('stammdaten')}
          >
            Stammdaten
          </button>
          <button
            type="button"
            className={view === 'settings' ? 'tab active' : 'tab'}
            onClick={() => setView('settings')}
          >
            Einstellungen
          </button>
          {showUpdateTab && (
            <button
              type="button"
              className={view === 'update' ? 'tab active' : 'tab'}
              onClick={() => setView('update')}
            >
              Update
              <span className="update-dot" aria-hidden="true" />
            </button>
          )}

          {/* Bottom of the sidebar, away from the tabs: it is not a place to go,
              and it ends the day for the guest tablets too. */}
          <div className="sidebar-bottom">
            {shutdownError && <p className="error">{shutdownError}</p>}
            <button
              type="button"
              className="btn danger shutdown"
              onClick={handleShutdown}
              disabled={!canShutdown || shuttingDown}
              title={canShutdown
                ? 'Server beenden'
                : 'Nur an dem Rechner möglich, auf dem Tandem läuft.'}
            >
              {shuttingDown ? 'Wird beendet…' : 'Programm beenden'}
            </button>
            {!canShutdown && (
              <p className="hint">
                Beenden ist nur an dem Rechner möglich, auf dem Tandem läuft.
              </p>
            )}
          </div>
        </nav>

        <main className={view === 'list' ? 'view' : 'view view-wide'}>
          {view === 'list' && <List onSelect={openDetail} date={date} onDateChange={chooseDate} />}
          {view === 'detail' && selected && (
            <Detail registration={selected} onBack={closeDetail} onSaved={setSelected} />
          )}
          {view === 'stammdaten' && <Stammdaten />}
          {view === 'settings' && <Settings />}
          {view === 'update' && update && (
            <Update status={update} onRefresh={refreshUpdate} />
          )}
        </main>
      </div>

      {showPrompt && update && (
        <UpdateDialog
          currentVersion={update.currentVersion}
          latestVersion={update.latestVersion!}
          onAccept={acceptUpdate}
          onLater={postponeUpdate}
        />
      )}
    </>
  )
}

export default App
