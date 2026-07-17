import { useState } from 'react'
import List from './List'
import Detail from './Detail'
import Stammdaten from './Stammdaten'
import Settings from './Settings'
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
    <div className="app-root">
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
  )
}

export default App
