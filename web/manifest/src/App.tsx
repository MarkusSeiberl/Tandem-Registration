import { useState } from 'react'
import List from './List'
import Detail from './Detail'
import Stammdaten from './Stammdaten'
import Settings from './Settings'
import Print from './Print'
import type { Registration } from './api'

type View = 'list' | 'detail' | 'stammdaten' | 'settings'

function App() {
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<Registration | null>(null)

  function openDetail(registration: Registration) {
    setSelected(registration)
    setView('detail')
  }

  function closeDetail() {
    setSelected(null)
    setView('list')
  }

  return (
    <>
      {/*
        Print sheet lives OUTSIDE `.app-root` on purpose: `.app-root` gets the
        `no-print` class below, which under `@media print` is forced to
        `display: none`. A `display: none` ancestor hides its descendants
        unconditionally — there's no CSS override that can bring a nested
        `.print-only` node back — so the print sheet must sit as a sibling,
        not a child, of the hidden app shell (see print.css).
      */}
      {selected && <Print registration={selected} />}

      <div className="app-root no-print">
        <nav className="tabs">
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
        </nav>

        <main className="view">
          {view === 'list' && <List onSelect={openDetail} />}
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
