import { useState } from 'react'
import { getApiBase, setApiBase } from './api'

export interface HiddenSettingsProps {
  onClose: () => void
}

export default function HiddenSettings({ onClose }: HiddenSettingsProps) {
  const [value, setValue] = useState(getApiBase())
  const [saved, setSaved] = useState(false)

  function handleSave() {
    setApiBase(value)
    setSaved(true)
  }

  return (
    <div className="overlay" role="dialog" aria-label="Einstellungen">
      <div className="overlay-panel">
        <h2>Server-Einstellungen</h2>
        <p>Server-Adresse (leer = gleicher Rechner):</p>
        <input
          type="text"
          value={value}
          placeholder="z. B. http://192.168.1.10:3000"
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
        />
        <div className="actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Schließen
          </button>
          <button type="button" className="btn primary" onClick={handleSave}>
            Speichern
          </button>
        </div>
        {saved && <p className="hint">Gespeichert. Seite ggf. neu laden.</p>}
      </div>
    </div>
  )
}
