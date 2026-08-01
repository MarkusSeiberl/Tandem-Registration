import { useEffect, useState } from 'react'
import { createBackup, getSettings, putSettings } from './api'
import type { Payouts, Prices } from './api'

// Every amount the manifest can charge, in the order the settings screen shows
// them. `key` matches the Config.prices field the server validates.
const PRICE_FIELDS: { key: keyof Prices; label: string }[] = [
  { key: 'jump', label: 'Tandemsprung' },
  { key: 'video', label: 'Video' },
  { key: 'video_photo', label: 'Video + Foto' },
  { key: 'weight_over_90', label: 'Zuschlag ab 90 kg' },
  { key: 'weight_over_100', label: 'Zuschlag ab 100 kg' },
]

// What the club pays out per jump. Separate from the prices above: these amounts
// leave the till, they never reach the guest.
const PAYOUT_FIELDS: { key: keyof Payouts; label: string }[] = [
  { key: 'tandem_master', label: 'Tandemmaster pro Sprung' },
  { key: 'video', label: 'Videoflieger Video' },
  { key: 'video_photo', label: 'Videoflieger Video + Foto' },
]

const EMPTY_PRICES: Prices = {
  jump: 0, video: 0, video_photo: 0, weight_over_90: 0, weight_over_100: 0,
}

const EMPTY_PAYOUTS: Payouts = { tandem_master: 0, video: 0, video_photo: 0 }

// Turns the typed strings of one block back into numbers, refusing anything that
// would silently save as 0 €.
function toAmounts<T extends Record<keyof T, number>>(
  fields: { key: keyof T; label: string }[],
  inputs: Record<keyof T, string>,
  empty: T,
  noun: string
): T {
  const out = { ...empty }
  for (const { key, label } of fields) {
    const raw = inputs[key]
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${noun} „${label}" ungültig`)
    }
    out[key] = value as T[keyof T]
  }
  return out
}

function toInputs<T extends Record<keyof T, number>>(
  fields: { key: keyof T; label: string }[],
  values: T
): Record<keyof T, string> {
  const out = {} as Record<keyof T, string>
  for (const { key } of fields) out[key] = String(values[key])
  return out
}

export default function Settings() {
  const [exportDir, setExportDir] = useState('')
  const [jumpLocation, setJumpLocation] = useState('')
  const [backupDir, setBackupDir] = useState('')
  // Held as strings so the field can be emptied while typing without snapping
  // back to 0; converted on save.
  const [priceInputs, setPriceInputs] = useState<Record<keyof Prices, string>>({
    jump: '', video: '', video_photo: '', weight_over_90: '', weight_over_100: '',
  })
  const [payoutInputs, setPayoutInputs] = useState<Record<keyof Payouts, string>>({
    tandem_master: '', video: '', video_photo: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [backingUp, setBackingUp] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  function applySettings(cfg: {
    exportDir: string; jumpLocation: string; backupDir: string
    prices?: Prices; payouts?: Payouts
  }) {
    setExportDir(cfg.exportDir)
    setJumpLocation(cfg.jumpLocation)
    setBackupDir(cfg.backupDir)
    setPriceInputs(toInputs(PRICE_FIELDS, cfg.prices ?? EMPTY_PRICES))
    setPayoutInputs(toInputs(PAYOUT_FIELDS, cfg.payouts ?? EMPTY_PAYOUTS))
  }

  useEffect(() => {
    getSettings()
      .then(applySettings)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const prices = toAmounts(PRICE_FIELDS, priceInputs, EMPTY_PRICES, 'Preis')
      const payouts = toAmounts(PAYOUT_FIELDS, payoutInputs, EMPTY_PAYOUTS, 'Vergütung')
      const cfg = await putSettings({ exportDir, jumpLocation, backupDir, prices, payouts })
      applySettings(cfg)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  async function handleBackup() {
    setBackingUp(true)
    setBackupError(null)
    setBackupMessage(null)
    try {
      const result = await createBackup()
      setBackupMessage(`Backup erstellt: ${result.path}`)
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Backup fehlgeschlagen')
    } finally {
      setBackingUp(false)
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

      <label className="field">
        Backup-Verzeichnis (leer = Export-Verzeichnis)
        <input
          type="text"
          value={backupDir}
          onChange={(e) => {
            setBackupDir(e.target.value)
            setSaved(false)
          }}
        />
      </label>

      <section className="prices-section">
        <h3>Preise (EUR)</h3>
        <p className="hint">
          Gilt für neu berechnete Preise. Bereits gespeicherte Registrierungen behalten ihren Preis.
        </p>
        {PRICE_FIELDS.map(({ key, label }) => (
          <label className="field" key={key}>
            {label}
            <input
              type="number"
              className="numeral"
              min="0"
              step="1"
              value={priceInputs[key]}
              onChange={(e) => {
                setPriceInputs((prev) => ({ ...prev, [key]: e.target.value }))
                setSaved(false)
              }}
            />
          </label>
        ))}
      </section>

      <section className="payouts-section">
        <h3>Vergütung (EUR)</h3>
        <p className="hint">
          Wird pro Sprung abgerechnet und erscheint im Excel-Export als eigener Block.
        </p>
        {PAYOUT_FIELDS.map(({ key, label }) => (
          <label className="field" key={key}>
            {label}
            <input
              type="number"
              className="numeral"
              min="0"
              step="1"
              value={payoutInputs[key]}
              onChange={(e) => {
                setPayoutInputs((prev) => ({ ...prev, [key]: e.target.value }))
                setSaved(false)
              }}
            />
          </label>
        ))}
      </section>

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="actions">
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>

      <section className="backup-section">
        <h2>Datenbank-Backup</h2>
        <p className="hint">
          Erstellt eine Sicherungskopie der Datenbank im Backup-Verzeichnis. Verzeichnis vorher
          speichern.
        </p>
        {backupError && <p className="error">{backupError}</p>}
        {backupMessage && !backupError && <p className="hint">{backupMessage}</p>}
        <div className="actions">
          <button type="button" className="btn secondary" onClick={handleBackup} disabled={backingUp}>
            {backingUp ? 'Erstellt…' : 'Backup erstellen'}
          </button>
        </div>
      </section>
    </div>
  )
}
