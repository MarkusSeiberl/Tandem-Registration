import { useState } from 'react'
import List from './List'
import Detail from './Detail'
import Stammdaten from './Stammdaten'
import Settings from './Settings'
import BrandMark from './BrandMark'
import Urkunde from './Urkunde'
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
        </nav>

        <main className={view === 'list' ? 'view' : 'view view-wide'}>
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
