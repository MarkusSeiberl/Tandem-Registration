import { useEffect, useState } from 'react'
import { getSettings, putSettings } from './api'

export default function Settings() {
  const [exportDir, setExportDir] = useState('')
  const [jumpLocation, setJumpLocation] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getSettings()
      .then((cfg) => {
        setExportDir(cfg.exportDir)
        setJumpLocation(cfg.jumpLocation)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const cfg = await putSettings({ exportDir, jumpLocation })
      setExportDir(cfg.exportDir)
      setJumpLocation(cfg.jumpLocation)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Lädt…</p>

  return (
    <div className="settings-screen">
      <h2>Einstellungen</h2>
      <label className="field">
        Export-Verzeichnis
        <input
          type="text"
          value={exportDir}
          onChange={(e) => {
            setExportDir(e.target.value)
            setSaved(false)
          }}
        />
      </label>

      <label className="field">
        Ort (für Vertragsunterschrift)
        <input
          type="text"
          value={jumpLocation}
          onChange={(e) => {
            setJumpLocation(e.target.value)
            setSaved(false)
          }}
        />
      </label>

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="actions">
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </div>
  )
}
