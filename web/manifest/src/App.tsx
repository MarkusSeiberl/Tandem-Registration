import { useCallback, useEffect, useRef, useState } from 'react'
import List from './List'
import Overview from './Overview'
import Detail from './Detail'
import Crew from './Crew'
import Tarife from './Tarife'
import Settings from './Settings'
import Update from './Update'
import UpdateDialog from './UpdateDialog'
import BrandMark from './BrandMark'
import type { Registration } from './api'
import { shutdownAllowed, shutdownApp } from './api'
import { getUpdateStatus, markUpdatePromptSeen, startUpdateDownload } from './api'
import type { UpdatePhase, UpdateStatus } from './api'
import { useUpdateEvents } from './useEvents'
import { takeInstallFrom } from './updateMarker'
import { rememberDate, storedDate } from './date'

type View = 'overview' | 'list' | 'detail' | 'tarife' | 'crew' | 'settings' | 'update'

// Marks the one history entry the app pushes when it leaves the manifest.
const AWAY_FROM_LIST = 'tandem-away-from-list'

const DISCARD_TARIFE = 'Ungespeicherte Änderungen an den Tarifen verwerfen?'
const DISCARD_SETTINGS = 'Ungespeicherte Änderungen an den Einstellungen verwerfen?'
const DISCARD_DETAIL = 'Ungespeicherte Änderungen an dieser Registrierung verwerfen?'

function App() {
  // The app opens on the Übersicht, where a jump day starts.
  const [view, setViewState] = useState<View>('overview')
  const [selected, setSelected] = useState<Registration | null>(null)

  // Prices apply to every future day and the guest signs the texts on
  // Einstellungen, so an edit on either screen is not dropped by a stray click
  // elsewhere without asking — nor is a guest's load and master on the detail
  // screen, left half-done when the operator is called away. Holds the question
  // to ask, or null when nothing is unsaved; one is enough, since only one of
  // these screens is mounted. A
  // ref, not state: the popstate and beforeunload handlers below are registered
  // once and must read it fresh.
  const discardQuestion = useRef<string | null>(null)
  const onTarifeDirtyChange = useCallback((dirty: boolean) => {
    discardQuestion.current = dirty ? DISCARD_TARIFE : null
  }, [])
  const onSettingsDirtyChange = useCallback((dirty: boolean) => {
    discardQuestion.current = dirty ? DISCARD_SETTINGS : null
  }, [])
  const onDetailDirtyChange = useCallback((dirty: boolean) => {
    discardQuestion.current = dirty ? DISCARD_DETAIL : null
  }, [])
  const mayLeave = () => discardQuestion.current === null || window.confirm(discardQuestion.current)

  // The browser's back button always leads to the manifest. Leaving the list
  // pushes a single history entry; moving on between other views replaces it,
  // so one press of back is enough however many tabs were visited.
  function setView(next: View) {
    if (next !== view && !mayLeave()) return
    const away = window.history.state === AWAY_FROM_LIST
    if (next === 'list') {
      // Pop our own entry rather than leaving it behind: the popstate handler
      // below then performs the switch, and back from the list leaves the app.
      if (away) window.history.back()
      else { setSelected(null); setViewState('list') }
      return
    }
    if (away) window.history.replaceState(AWAY_FROM_LIST, '')
    else window.history.pushState(AWAY_FROM_LIST, '')
    setViewState(next)
  }

  useEffect(() => {
    // A reload keeps the history entry but starts on the Übersicht again.
    if (window.history.state === AWAY_FROM_LIST) window.history.replaceState(null, '')
    function onPopState() {
      if (window.history.state === AWAY_FROM_LIST) return
      // The browser has already gone back; staying means putting the entry
      // that back just removed in place again.
      if (!mayLeave()) {
        window.history.pushState(AWAY_FROM_LIST, '')
        return
      }
      setSelected(null)
      setViewState('list')
    }
    // Closing or reloading the window: the browser shows its own question.
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (discardQuestion.current !== null) e.preventDefault()
    }
    window.addEventListener('popstate', onPopState)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      window.removeEventListener('popstate', onPopState)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

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

  // Set once after a restart the operator started from the Update screen:
  // either the version it was updated to, or nothing when it rolled back (in
  // which case the Update screen, with its explanation, opens instead).
  const [updatedTo, setUpdatedTo] = useState<string | null>(null)
  const [updateActionError, setUpdateActionError] = useState<string | null>(null)

  useEffect(() => {
    getUpdateStatus()
      .then((status) => {
        setUpdate(status)
        const from = takeInstallFrom()
        if (from === null) return
        if (status.currentVersion !== from) setUpdatedTo(status.currentVersion)
        else if (status.phase === 'install-failed') {
          // setView's steps without its leave-guard: the page has just loaded,
          // so there is no unsaved edit to ask about.
          window.history.pushState(AWAY_FROM_LIST, '')
          setViewState('update')
        }
      })
      .catch(() => {
        // An older server without the update routes. No entry, no dialog —
        // exactly what a server that cannot update itself should show.
      })
  }, [])

  useUpdateEvents(update?.allowed === true, (status) => {
    // The page usually loads before the startup check has run (the exe opens
    // the browser as soon as it listens, the check follows a second later), and the
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

  // Always there on the machine that can act, so "am I up to date?" has an
  // answer; the dot only while something is actually pending.
  const PENDING: UpdatePhase[] = [
    'available', 'downloading', 'verifying', 'ready', 'download-failed', 'install-failed',
  ]
  const showUpdateTab = update?.allowed === true && update.phase !== 'disabled'
  const updatePending = update !== null && PENDING.includes(update.phase)
  const installing = update?.phase === 'installing'

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
    // Unlike the courtesy call above, a failed download start is the
    // operator's business: the Update screen they land on says so.
    setUpdateActionError(null)
    void startUpdateDownload()
      .then(refreshUpdate)
      .catch((err) => {
        setUpdateActionError(
          err instanceof Error ? err.message : 'Download konnte nicht gestartet werden'
        )
      })
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

  // From the Übersicht: "Neuer Tandemtag" and a click on a calendar day both
  // land on the manifest of that day.
  function openDay(next: string) {
    chooseDate(next)
    setView('list')
  }

  function openDetail(registration: Registration) {
    setSelected(registration)
    setView('detail')
  }

  function closeDetail() {
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
      <div className="app-root">
        <nav className="sidebar">
          <div className="brand">
            <BrandMark size={26} />
            Tandem Manifest
          </div>
          <button
            type="button"
            className={view === 'overview' ? 'tab active' : 'tab'}
            onClick={() => setView('overview')}
          >
            Übersicht
          </button>
          <button
            type="button"
            className={view === 'list' || view === 'detail' ? 'tab active' : 'tab'}
            onClick={() => setView('list')}
          >
            Manifest
          </button>
          <button
            type="button"
            className={view === 'tarife' ? 'tab active' : 'tab'}
            onClick={() => setView('tarife')}
          >
            Tarife
          </button>
          <button
            type="button"
            className={view === 'crew' ? 'tab active' : 'tab'}
            onClick={() => setView('crew')}
          >
            Crew
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
              {updatePending && <span className="update-dot" aria-hidden="true" />}
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
              // Not mid-install: the installer is already stopping and
              // restarting the server, and a second stop could leave it down.
              disabled={!canShutdown || shuttingDown || installing}
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
            {/* The status route answers every device, not just the host PC, so
                this shows on the tablets too. Absent only on an older server. */}
            {update && <p className="app-version">Version {update.currentVersion}</p>}
          </div>
        </nav>

        <main className={view === 'list' ? 'view' : 'view view-wide'}>
          {updatedTo && (
            <div className="update-done-note" role="status">
              <p>Tandem wurde auf Version {updatedTo} aktualisiert.</p>
              <button type="button" className="btn secondary" onClick={() => setUpdatedTo(null)}>
                OK
              </button>
            </div>
          )}
          {view === 'overview' && <Overview onOpenDay={openDay} />}
          {view === 'list' && <List onSelect={openDetail} date={date} onDateChange={chooseDate} />}
          {view === 'detail' && selected && (
            <Detail
              registration={selected}
              onBack={closeDetail}
              onSaved={setSelected}
              onDirtyChange={onDetailDirtyChange}
            />
          )}
          {view === 'tarife' && <Tarife onDirtyChange={onTarifeDirtyChange} />}
          {view === 'crew' && <Crew />}
          {view === 'settings' && <Settings onDirtyChange={onSettingsDirtyChange} />}
          {view === 'update' && update && (
            <Update
              key={updateActionError ?? ''}
              status={update}
              onRefresh={refreshUpdate}
              actionError={updateActionError}
            />
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
