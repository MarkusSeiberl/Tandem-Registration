import { useEffect, useState } from 'react'
import { createBackup, getSettings, putSettings } from './api'

// Where the manifest writes and what it prints on a contract. The amounts it
// charges and pays out live on the Stammdaten screen, beside the crew.
export default function Settings() {
  const [exportDir, setExportDir] = useState('')
  const [jumpLocation, setJumpLocation] = useState('')
  const [backupDir, setBackupDir] = useState('')
  const [contractText, setContractText] = useState('')
  const [privacyText, setPrivacyText] = useState('')
  const [voucherListPath, setVoucherListPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [backingUp, setBackingUp] = useState(false)
  const [backupMessage, setBackupMessage] = useState<string | null>(null)
  const [backupError, setBackupError] = useState<string | null>(null)

  function applySettings(cfg: {
    exportDir: string; jumpLocation: string; backupDir: string
    contractText: string; privacyText: string; voucherListPath: string
  }) {
    setExportDir(cfg.exportDir)
    setJumpLocation(cfg.jumpLocation)
    setBackupDir(cfg.backupDir)
    setContractText(cfg.contractText)
    setPrivacyText(cfg.privacyText)
    setVoucherListPath(cfg.voucherListPath)
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
      // The server merges the price and payout blocks, so leaving them out here
      // keeps whatever the Stammdaten screen saved.
      const cfg = await putSettings({
        exportDir, jumpLocation, backupDir, contractText, privacyText, voucherListPath,
      })
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

      <label className="field">
        Gutscheinliste (Excel-Datei)
        <input
          type="text"
          value={voucherListPath}
          onChange={(e) => {
            setVoucherListPath(e.target.value)
            setSaved(false)
          }}
        />
        <span className="field-hint">
          Vollständiger Pfad zur Tandemliste des Vereins. Leer lassen, wenn keine
          Gutscheinprüfung gewünscht ist.
        </span>
      </label>

      {/*
        Both texts the guest gets to read before signing. They live here rather
        than only in config.json because a wrong address or an outdated retention
        period is a legal problem, and fixing it must not need a new build.
      */}
      <label className="field">
        Datenschutztext
        <textarea
          rows={10}
          value={privacyText}
          onChange={(e) => {
            setPrivacyText(e.target.value)
            setSaved(false)
          }}
        />
        <span className="field-hint">
          Wird dem Gast vor der Unterschrift gezeigt und muss von ihm bestätigt werden.
          Angaben in eckigen Klammern ersetzen.
        </span>
      </label>

      <label className="field">
        Vertragstext
        <textarea
          rows={10}
          value={contractText}
          onChange={(e) => {
            setContractText(e.target.value)
            setSaved(false)
          }}
        />
        <span className="field-hint">Der Beförderungsvertrag, den der Gast liest und unterschreibt.</span>
      </label>

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
