import { useEffect, useState } from 'react'
import List from './List'
import Detail from './Detail'
import Stammdaten from './Stammdaten'
import Settings from './Settings'
import BrandMark from './BrandMark'
import Urkunde from './Urkunde'
import type { Registration } from './api'
import { shutdownAllowed, shutdownApp } from './api'
import { rememberDate, storedDate } from './date'

type View = 'list' | 'detail' | 'stammdaten' | 'settings'

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
        </main>
      </div>
    </>
  )
}

export default App
