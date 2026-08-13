import { useEffect, useId, useState } from 'react'
import { checkPaths, createBackup, getSettings, pickerAvailable, pickPath, putSettings } from './api'
import type { PathChecks, PathState, PickKind } from './api'

// A path field: the text is still typeable, the button is the shortcut. What the
// warning says depends on what was expected there, so the message is built from
// the kind rather than passed in at every call site.
const PATH_WARNINGS: Record<PickKind, Record<Exclude<PathState, 'ok'>, string>> = {
  directory: { missing: 'Verzeichnis existiert nicht', 'wrong-type': 'Pfad ist kein Verzeichnis' },
  'excel-file': { missing: 'Datei existiert nicht', 'wrong-type': 'Pfad ist keine Datei' },
}

function PathField(props: {
  label: string
  // The button's accessible name. Spelled out rather than derived from `label`,
  // which carries parenthesised explanations no screen reader needs to repeat.
  browseLabel: string
  kind: PickKind
  value: string
  onChange: (value: string) => void
  onBrowse?: () => void
  browsing?: boolean
  state?: PathState
  hint?: string
}) {
  const id = useId()
  const warning = props.state && props.state !== 'ok'
    ? PATH_WARNINGS[props.kind][props.state]
    : null
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <div className="path-row">
        <input
          id={id}
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
        />
        {props.onBrowse && (
          <button
            type="button"
            className="btn secondary"
            aria-label={props.browseLabel}
            onClick={props.onBrowse}
            disabled={props.browsing}
          >
            Durchsuchen…
          </button>
        )}
      </div>
      {props.hint && <span className="field-hint">{props.hint}</span>}
      {warning && <span className="field-hint warn">{warning}</span>}
    </div>
  )
}

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

  // Only the machine running tandem.exe gets the dialog buttons — see
  // src/server/routes/pickPath.ts for why the server decides this.
  const [canPick, setCanPick] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [checks, setChecks] = useState<PathChecks>({})

  // Both texts stay mounted; only one is shown. Unmounting the other would throw
  // away an edit the operator made before switching, and Speichern commits both.
  const [textTab, setTextTab] = useState<'privacy' | 'contract'>('privacy')
  const textIds = useId()

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
    // Whatever the server just confirmed is what gets checked — checking the
    // fields on screen would warn about a path nobody has saved yet.
    void checkPaths({
      exportDir: cfg.exportDir,
      backupDir: cfg.backupDir,
      voucherListPath: cfg.voucherListPath,
    }).then(setChecks)
  }

  useEffect(() => {
    getSettings()
      .then(applySettings)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
    void pickerAvailable().then(setCanPick)
  }, [])

  async function browse(kind: PickKind, current: string, apply: (path: string) => void) {
    // There is one desktop, so there is one dialog. The server refuses a second
    // one anyway; this keeps the operator from asking for it.
    setBrowsing(true)
    try {
      const picked = await pickPath(kind, current)
      // null means the operator closed the dialog — leave what was there.
      if (picked === null) return
      apply(picked)
      setSaved(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auswahl fehlgeschlagen')
    } finally {
      setBrowsing(false)
    }
  }

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

      <div className="settings-cols">
        <div className="settings-col">
          <section className="panel" aria-label="Pfade & Ort">
            <h3 className="panel-title">Pfade &amp; Ort</h3>

            <PathField
              label="Export-Verzeichnis"
              browseLabel="Export-Verzeichnis auswählen"
              kind="directory"
              value={exportDir}
              state={checks.exportDir}
              onChange={(value) => {
                setExportDir(value)
                setSaved(false)
              }}
              onBrowse={canPick ? () => browse('directory', exportDir, setExportDir) : undefined}
              browsing={browsing}
            />

            <PathField
              label="Backup-Verzeichnis (leer = Export-Verzeichnis)"
              browseLabel="Backup-Verzeichnis auswählen"
              kind="directory"
              value={backupDir}
              state={checks.backupDir}
              onChange={(value) => {
                setBackupDir(value)
                setSaved(false)
              }}
              onBrowse={canPick ? () => browse('directory', backupDir, setBackupDir) : undefined}
              browsing={browsing}
            />

            <PathField
              label="Gutscheinliste (Excel-Datei)"
              browseLabel="Gutscheinliste auswählen"
              kind="excel-file"
              value={voucherListPath}
              state={checks.voucherListPath}
              hint={
                'Vollständiger Pfad zur Tandemliste des Vereins. Leer lassen, wenn keine ' +
                'Gutscheinprüfung gewünscht ist.'
              }
              onChange={(value) => {
                setVoucherListPath(value)
                setSaved(false)
              }}
              onBrowse={
                canPick ? () => browse('excel-file', voucherListPath, setVoucherListPath) : undefined
              }
              browsing={browsing}
            />

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
          </section>

          {/*
            Its own block because its button acts on its own: Backup erstellen
            runs immediately and is not part of what Speichern commits.
          */}
          <section className="panel" aria-label="Datenbank-Backup">
            <h3 className="panel-title">Datenbank-Backup</h3>
            <p className="field-hint">
              Erstellt eine Sicherungskopie der Datenbank im Backup-Verzeichnis. Verzeichnis vorher
              speichern.
            </p>
            {backupError && <p className="error">{backupError}</p>}
            {backupMessage && !backupError && <p className="hint">{backupMessage}</p>}
            <div>
              <button
                type="button"
                className="btn secondary"
                onClick={handleBackup}
                disabled={backingUp}
              >
                {backingUp ? 'Erstellt…' : 'Backup erstellen'}
              </button>
            </div>
          </section>
        </div>

        {/*
          Both texts the guest gets to read before signing. They live here rather
          than only in config.json because a wrong address or an outdated retention
          period is a legal problem, and fixing it must not need a new build. One
          shows at a time: two ten-row textareas stacked is what made this screen
          longer than the window.
        */}
        <section className="panel text-panel" aria-label="Texte">
          <div className="text-tabs" role="tablist" aria-label="Texte für den Gast">
            <button
              type="button"
              role="tab"
              className="text-tab"
              id={`${textIds}-privacy-tab`}
              aria-controls={`${textIds}-privacy-panel`}
              aria-selected={textTab === 'privacy'}
              onClick={() => setTextTab('privacy')}
            >
              Datenschutztext
            </button>
            <button
              type="button"
              role="tab"
              className="text-tab"
              id={`${textIds}-contract-tab`}
              aria-controls={`${textIds}-contract-panel`}
              aria-selected={textTab === 'contract'}
              onClick={() => setTextTab('contract')}
            >
              Vertragstext
            </button>
          </div>

          {/*
            Named separately from its tab rather than via aria-labelledby: a
            name containing the tab's own wording would collide with the
            textarea's aria-label in label-text queries.
          */}
          <div
            className="text-body"
            role="tabpanel"
            id={`${textIds}-privacy-panel`}
            aria-label="Datenschutz"
            hidden={textTab !== 'privacy'}
          >
            <textarea
              aria-label="Datenschutztext"
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
          </div>

          <div
            className="text-body"
            role="tabpanel"
            id={`${textIds}-contract-panel`}
            aria-label="Vertrag"
            hidden={textTab !== 'contract'}
          >
            <textarea
              aria-label="Vertragstext"
              value={contractText}
              onChange={(e) => {
                setContractText(e.target.value)
                setSaved(false)
              }}
            />
            <span className="field-hint">
              Der Beförderungsvertrag, den der Gast liest und unterschreibt.
            </span>
          </div>
        </section>
      </div>

      <div className="save-bar">
        {error && <p className="error">{error}</p>}
        {saved && !error && <p className="hint">Gespeichert.</p>}
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </div>
  )
}
