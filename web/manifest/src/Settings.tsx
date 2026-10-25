import {
  Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState,
} from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { checkPaths, createBackup, getSettings, pickerAvailable, pickPath, putSettings } from './api'
import type { PathChecks, PathState, PickKind, Settings as SettingsType } from './api'
import { renderRichText, toggleMarker } from './richText'
import type { Marker } from './richText'

// A path field: the text is still typeable, the button is the shortcut. What the
// warning says depends on what was expected there, so the message is built from
// the kind rather than passed in at every call site. A missing directory is not
// an error: export and backup create it the first time they write. What the
// warning is for is the typo that would have them create the wrong one.
const PATH_WARNINGS: Record<PickKind, Record<Exclude<PathState, 'ok'>, string>> = {
  directory: {
    missing: 'Verzeichnis existiert noch nicht und wird beim ersten Schreiben angelegt. ' +
      'Pfad auf Tippfehler prüfen.',
    'wrong-type': 'Pfad ist kein Verzeichnis',
  },
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
  onBlur?: () => void
  onBrowse?: () => void
  browsing?: boolean
  state?: PathState
  hint?: string
  inputRef?: (el: HTMLInputElement | null) => void
}) {
  const id = useId()
  const warning = props.state && props.state !== 'ok'
    ? PATH_WARNINGS[props.kind][props.state]
    : null
  // Read out with the field rather than found by wandering past it. Not
  // aria-invalid: a missing path is worth knowing and still saves.
  const describedBy = [props.hint && `${id}-hint`, warning && `${id}-warning`]
    .filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <div className="path-row">
        <input
          id={id}
          ref={props.inputRef}
          aria-describedby={describedBy}
          type="text"
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          onBlur={props.onBlur}
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
      {props.hint && <span id={`${id}-hint`} className="field-hint">{props.hint}</span>}
      {warning && <span id={`${id}-warning`} className="field-hint warn">{warning}</span>}
    </div>
  )
}

// The three markers the texts carry, in the order the toolbar offers them. The
// letter is the one the button shows; the key is the shortcut every word
// processor has trained the operator to reach for.
const FORMATS: { marker: Marker; letter: string; label: string; key: string }[] = [
  { marker: '**', letter: 'F', label: 'Fett', key: 'b' },
  { marker: '*', letter: 'K', label: 'Kursiv', key: 'i' },
  { marker: '__', letter: 'U', label: 'Unterstrichen', key: 'u' },
]

// An entry still waiting to be filled in, the way the shipped texts write one:
// „[Aufbewahrungsdauer eintragen, z. B. 7 Jahre.]“. Within one line, so a
// stray bracket cannot claim a whole paragraph.
const PLACEHOLDER = /\[[^[\]\n]*\]/g
const PLACEHOLDER_SPLIT = /(\[[^[\]\n]*\])/

const countPlaceholders = (text: string) => text.match(PLACEHOLDER)?.length ?? 0

/**
 * Marks the placeholders in what renderRichText drew. Done on its output rather
 * than inside it: the renderer has to stay character for character the guest's,
 * and the guest is never meant to see a placeholder in the first place.
 */
function markPlaceholders(nodes: ReactNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    if (typeof node === 'string') {
      return node.split(PLACEHOLDER_SPLIT).map((part, j) =>
        j % 2 === 1 ? <mark key={`${i}-${j}`} className="placeholder">{part}</mark> : part
      )
    }
    if (isValidElement<{ children?: ReactNode }>(node)) {
      return cloneElement(node, undefined, markPlaceholders(Children.toArray(node.props.children)))
    }
    return node
  })
}

/**
 * One of the two texts the guest reads, with the only formatting they carry:
 * `**fett**`, `*kursiv*` and `__unterstrichen__`.
 *
 * A textarea rather than a contenteditable field. The typing here is legal
 * prose, often pasted from a lawyer's mail, and a textarea gets that right —
 * cursor, undo, paste and all — where a rich field would need every one of them
 * rebuilt. What was missing was never the typing; it was seeing the result. So
 * the markers stay visible in the editor and the preview below shows the text
 * exactly as the tablet will draw it, with the same renderer the guest app uses.
 */
function TextEditor({
  label,
  value,
  hint,
  error,
  onChange,
  inputRef,
}: {
  label: string
  value: string
  hint: string
  // Why the last save refused this text, said where the text is.
  error?: string
  onChange: (next: string) => void
  inputRef?: (el: HTMLTextAreaElement | null) => void
}) {
  const areaRef = useRef<HTMLTextAreaElement | null>(null)
  const id = useId()

  function apply(marker: Marker) {
    const area = areaRef.current
    if (!area) return
    const next = toggleMarker(value, area.selectionStart, area.selectionEnd, marker)
    onChange(next.value)
    // After React writes the new value the selection is gone, so it is put back
    // on the next frame — around the same words, so the button can be pressed
    // twice to undo itself.
    requestAnimationFrame(() => {
      area.focus()
      area.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!(e.ctrlKey || e.metaKey)) return
    const format = FORMATS.find((f) => f.key === e.key.toLowerCase())
    if (!format) return
    // Strg+U is the browser's „view source“; inside this textarea it belongs to
    // the editor, so all three shortcuts are claimed the same way.
    e.preventDefault()
    apply(format.marker)
  }

  return (
    <>
      <div className="text-toolbar">
        {FORMATS.map((format) => (
          <button
            key={format.marker}
            type="button"
            className="btn secondary small"
            onClick={() => apply(format.marker)}
          >
            <span className={`marker-letter marker-${format.key}`}>{format.letter}</span>
            &nbsp;{format.label}
          </button>
        ))}
        <span className="field-hint">
          Auswahl markieren und auf eine Schaltfläche tippen (oder Strg+B, Strg+I,
          Strg+U). Im Text steht **fett** zwischen zwei Sternchen, *kursiv* zwischen
          einem und __unterstrichen__ zwischen zwei Unterstrichen.
        </span>
      </div>

      <textarea
        ref={(el) => {
          areaRef.current = el
          inputRef?.(el)
        }}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error ${id}-hint` : `${id}-hint`}
        value={value}
        onKeyDown={handleKeyDown}
        onChange={(e) => onChange(e.target.value)}
      />
      {error && <p id={`${id}-error`} className="error text-error">{error}</p>}

      {/* Labelled by the word on the box itself. An aria-label carrying the
          text's name would collide with the textarea's own in every
          label-text lookup, and the two are meant to be told apart. */}
      <div className="text-preview">
        <span className="text-preview-label">Vorschau</span>
        <p>{markPlaceholders(renderRichText(value))}</p>
      </div>

      <span id={`${id}-hint`} className="field-hint">{hint}</span>
    </>
  )
}

// Everything Speichern commits, in the shape the server returns it: where the
// manifest writes and what it prints on a contract. The amounts it charges and
// pays out live on the Tarife screen.
type Form = Pick<
  SettingsType,
  'exportDir' | 'jumpLocation' | 'backupDir' | 'contractText' | 'privacyText' | 'voucherListPath'
>
type FormKey = keyof Form

// In the order the screen shows them, so Verwerfen can go back to the first
// change the operator would find reading down the page.
const FORM_KEYS: FormKey[] = [
  'exportDir', 'backupDir', 'voucherListPath', 'jumpLocation', 'privacyText', 'contractText',
]

const EMPTY_FORM: Form = {
  exportDir: '', jumpLocation: '', backupDir: '', contractText: '', privacyText: '',
  voucherListPath: '',
}

type TextKey = 'privacyText' | 'contractText'

const TEXT_NAMES: Record<TextKey, string> = {
  privacyText: 'Datenschutztext',
  contractText: 'Vertragstext',
}

// In the order of the tabs.
const TEXT_KEYS: TextKey[] = ['privacyText', 'contractText']

type PathKey = 'exportDir' | 'backupDir' | 'voucherListPath'

// The first placeholder in a text, for jumping to it. A fresh expression rather
// than PLACEHOLDER, whose global flag would carry lastIndex between calls.
const firstPlaceholder = (text: string) => /\[[^[\]\n]*\]/.exec(text)

// api.getSettings throws this sentence for a refused request; a network failure
// brings its own words, which are worth showing under it.
const LOAD_FAILED = 'Einstellungen konnten nicht geladen werden'

// Not saved at all: a guest shown an empty page would confirm or sign nothing.
const EMPTY_TEXT_ERRORS: Record<TextKey, string> = {
  privacyText: 'Der Datenschutztext ist leer. Ohne ihn kann der Gast nichts bestätigen.',
  contractText: 'Der Vertragstext ist leer. Ohne ihn hätte der Gast nichts zu unterschreiben.',
}

const formOf = (cfg: Form): Form => ({
  exportDir: cfg.exportDir,
  jumpLocation: cfg.jumpLocation,
  backupDir: cfg.backupDir,
  contractText: cfg.contractText,
  privacyText: cfg.privacyText,
  voucherListPath: cfg.voucherListPath,
})

interface SettingsProps {
  // Told whenever unsaved edits appear or go, so the app can ask before a tab
  // switch or a closed window throws them away.
  onDirtyChange?: (dirty: boolean) => void
}

export default function Settings({ onDirtyChange }: SettingsProps) {
  const [form, setForm] = useState(EMPTY_FORM)
  // What the server holds: the baseline "Ungespeicherte Änderungen" and
  // Verwerfen are measured against.
  const [stored, setStored] = useState(EMPTY_FORM)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The text a save was refused for because it is empty, so the reason can
  // stand under that text and not only in the save bar.
  const [emptyText, setEmptyText] = useState<TextKey | null>(null)
  const [saved, setSaved] = useState(false)
  const fieldRefs = useRef(new Map<FormKey, HTMLInputElement | HTMLTextAreaElement>())

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
  const locationId = useId()
  const backupId = useId()

  function applySettings(cfg: Form) {
    const next = formOf(cfg)
    setForm(next)
    setStored(next)
    void checkPaths({
      exportDir: next.exportDir,
      backupDir: next.backupDir,
      voucherListPath: next.voucherListPath,
    }).then(setChecks)
  }

  // A typed path is checked when the field is left, not after Speichern: a
  // typo found only once it is saved has already been written to the config.
  function checkField(key: PathKey, value: string) {
    void checkPaths({ [key]: value }).then((result) =>
      setChecks((prev) => ({ ...prev, [key]: result[key] })))
  }

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    getSettings()
      .then(applySettings)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : LOAD_FAILED))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    void pickerAvailable().then(setCanPick)
  }, [load])

  const changed = (key: FormKey) => form[key] !== stored[key]
  const dirty = FORM_KEYS.some(changed)

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  // Leaving the screen leaves nothing unsaved behind it.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  function edit(key: FormKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setSaved(false)
    // Whatever the last save said no to is being fixed now.
    setError(null)
    setEmptyText(null)
  }

  // A text in the hidden tab is brought into view first, or it could not take
  // the focus.
  function focusField(key: FormKey) {
    if (key === 'privacyText') setTextTab('privacy')
    if (key === 'contractText') setTextTab('contract')
    requestAnimationFrame(() => fieldRefs.current.get(key)?.focus())
  }

  // Opens the text and selects its first placeholder, ready to be typed over.
  function jumpToPlaceholder(key: TextKey) {
    const match = firstPlaceholder(form[key])
    setTextTab(key === 'privacyText' ? 'privacy' : 'contract')
    requestAnimationFrame(() => {
      const area = fieldRefs.current.get(key)
      if (!area) return
      area.focus()
      if (match) area.setSelectionRange(match.index, match.index + match[0].length)
    })
  }

  const fieldRef = (key: FormKey) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (el) fieldRefs.current.set(key, el)
    else fieldRefs.current.delete(key)
  }

  async function browse(kind: PickKind, key: FormKey) {
    // There is one desktop, so there is one dialog. The server refuses a second
    // one anyway; this keeps the operator from asking for it.
    setBrowsing(true)
    try {
      const picked = await pickPath(kind, form[key])
      // null means the operator closed the dialog — leave what was there.
      if (picked === null) return
      edit(key, picked)
      if (key === 'exportDir' || key === 'backupDir' || key === 'voucherListPath') {
        checkField(key, picked)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auswahl fehlgeschlagen')
    } finally {
      setBrowsing(false)
    }
  }

  async function handleSave() {
    setError(null)
    setSaved(false)
    const empty = TEXT_KEYS.find((key) => form[key].trim() === '')
    if (empty) {
      setEmptyText(empty)
      setError(`Nicht gespeichert: ${TEXT_NAMES[empty]} ist leer.`)
      focusField(empty)
      return
    }
    // Asked only for a text this save changes. A placeholder that was already
    // stored is listed above the tabs all the time; asking about it on every
    // save of a folder path would teach the operator to click it away.
    const unfinished = placeholders.filter(({ key }) => changed(key))
    if (unfinished.length > 0) {
      const question =
        unfinished.map(({ message }) => message).join('\n') +
        '\n\nDer Gast bekommt den Text so zu lesen, mit den Klammern. Trotzdem speichern?'
      if (!window.confirm(question)) {
        jumpToPlaceholder(unfinished[0].key)
        return
      }
    }
    setSaving(true)
    try {
      // The server merges the price and payout blocks, so leaving them out here
      // keeps whatever the Tarife screen saved.
      const cfg = await putSettings(form)
      applySettings(cfg)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  function discard() {
    // Verwerfen disappears with the changes; the cursor goes back to where the
    // first of them was rather than falling out of the page.
    const first = FORM_KEYS.find(changed)
    setForm(stored)
    setError(null)
    setEmptyText(null)
    if (first) focusField(first)
  }

  const locationMissing = form.jumpLocation.trim() === ''

  // Read off what is typed, not what is saved: these are about the words the
  // guest will get, and they should change the moment the words do. Listed
  // above both tabs, so one in the text that is not showing is seen too.
  const placeholders = TEXT_KEYS
    .map((key) => ({ key, count: countPlaceholders(form[key]) }))
    .filter(({ count }) => count > 0)
    .map(({ key, count }) => ({
      key,
      message:
        `${TEXT_NAMES[key]}: ${count} ${count === 1 ? 'Angabe' : 'Angaben'} in eckigen Klammern ` +
        'noch nicht ersetzt.',
    }))

  // The server backs up into the saved directory, not the one on screen, so a
  // backup taken now would land somewhere the operator has just typed away.
  // An empty backup directory means the export directory, as the label says.
  const backupTarget = (f: Form) => f.backupDir.trim() || f.exportDir
  const backupPathUnsaved = backupTarget(form) !== backupTarget(stored)

  async function handleBackup() {
    setBackingUp(true)
    setBackupError(null)
    setBackupMessage(null)
    try {
      const result = await createBackup()
      setBackupMessage(`Backup erstellt: ${result.path}`)
      // The backup may just have created the directory a warning was about.
      void checkPaths({ exportDir: stored.exportDir, backupDir: stored.backupDir })
        .then((result) => setChecks((prev) => ({ ...prev, ...result })))
    } catch (err) {
      setBackupError(err instanceof Error ? err.message : 'Backup fehlgeschlagen')
    } finally {
      setBackingUp(false)
    }
  }

  if (loading) return <p className="field-hint">Lädt…</p>

  // No form without the saved settings: an empty one saved by mistake would
  // blank both texts the guest signs, along with every path.
  if (loadError) {
    return (
      <div className="load-failed">
        <p className="error">{LOAD_FAILED}.</p>
        {loadError !== LOAD_FAILED && <p className="field-hint">{loadError}</p>}
        <button type="button" className="btn secondary" onClick={load}>
          Erneut versuchen
        </button>
      </div>
    )
  }

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
              value={form.exportDir}
              state={checks.exportDir}
              onChange={(value) => edit('exportDir', value)}
              onBlur={() => checkField('exportDir', form.exportDir)}
              onBrowse={canPick ? () => browse('directory', 'exportDir') : undefined}
              browsing={browsing}
              inputRef={fieldRef('exportDir')}
            />

            <PathField
              label="Backup-Verzeichnis (leer = Export-Verzeichnis)"
              browseLabel="Backup-Verzeichnis auswählen"
              kind="directory"
              value={form.backupDir}
              state={checks.backupDir}
              onChange={(value) => edit('backupDir', value)}
              onBlur={() => checkField('backupDir', form.backupDir)}
              onBrowse={canPick ? () => browse('directory', 'backupDir') : undefined}
              browsing={browsing}
              inputRef={fieldRef('backupDir')}
            />

            <PathField
              label="Gutscheinliste (Excel-Datei)"
              browseLabel="Gutscheinliste auswählen"
              kind="excel-file"
              value={form.voucherListPath}
              state={checks.voucherListPath}
              hint={
                'Vollständiger Pfad zur Tandemliste des Vereins. Leer lassen, wenn keine ' +
                'Gutscheinprüfung gewünscht ist.'
              }
              onChange={(value) => edit('voucherListPath', value)}
              onBlur={() => checkField('voucherListPath', form.voucherListPath)}
              onBrowse={canPick ? () => browse('excel-file', 'voucherListPath') : undefined}
              browsing={browsing}
              inputRef={fieldRef('voucherListPath')}
            />

            <div className="field">
              <label htmlFor={locationId}>Ort (für Vertragsunterschrift)</label>
              <input
                id={locationId}
                ref={fieldRef('jumpLocation')}
                aria-describedby={locationMissing ? `${locationId}-warning` : undefined}
                type="text"
                value={form.jumpLocation}
                onChange={(e) => edit('jumpLocation', e.target.value)}
              />
              {/* Worth seeing, not blocking: a club setting up its paths may not
                  have decided yet what goes beside the signature. */}
              {locationMissing && (
                <span id={`${locationId}-warning`} className="field-hint warn">
                  Ort fehlt. Im Vertrag bleibt er neben der Unterschrift leer.
                </span>
              )}
            </div>
          </section>

          {/*
            Its own block because its button acts on its own: Backup erstellen
            runs immediately and is not part of what Speichern commits.
          */}
          <section className="panel" aria-label="Datenbank-Backup">
            <h3 className="panel-title">Datenbank-Backup</h3>
            <p className="field-hint">
              Erstellt eine Sicherungskopie der Datenbank im Backup-Verzeichnis.
            </p>
            {backupPathUnsaved && (
              <p id={`${backupId}-unsaved`} className="field-hint warn">
                Erst speichern: Das Backup geht in das gespeicherte Verzeichnis, nicht in das
                geänderte.
              </p>
            )}
            <div>
              <button
                type="button"
                className="btn secondary"
                onClick={handleBackup}
                disabled={backingUp || backupPathUnsaved}
                aria-describedby={backupPathUnsaved ? `${backupId}-unsaved` : undefined}
              >
                {backingUp ? 'Erstellt…' : 'Backup erstellen'}
              </button>
            </div>
            {/* After the button, so its result does not push it away, and
                always mounted so a screen reader hears the result. */}
            <div role="status" aria-live="polite">
              {backupError && <p className="error">{backupError}</p>}
              {backupMessage && !backupError && <p className="hint">{backupMessage}</p>}
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
              {/* The tab that is not showing can still hold the edit; the dot
                  says so without opening it. The save bar says it in words. */}
              {changed('privacyText') && <span className="text-tab-dot" aria-hidden="true" />}
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
              {changed('contractText') && <span className="text-tab-dot" aria-hidden="true" />}
            </button>
          </div>

          {/* Each line takes the operator to its first placeholder, selected,
              so the fix is typing over it. */}
          {placeholders.length > 0 && (
            <div className="text-warnings">
              {placeholders.map(({ key, message }) => (
                <button
                  key={key}
                  type="button"
                  className="text-warning"
                  onClick={() => jumpToPlaceholder(key)}
                >
                  {message}
                </button>
              ))}
            </div>
          )}

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
            <TextEditor
              label="Datenschutztext"
              value={form.privacyText}
              hint="Wird dem Gast vor der Unterschrift gezeigt und muss von ihm bestätigt werden. Angaben in eckigen Klammern ersetzen."
              error={emptyText === 'privacyText' ? EMPTY_TEXT_ERRORS.privacyText : undefined}
              onChange={(next) => edit('privacyText', next)}
              inputRef={fieldRef('privacyText')}
            />
          </div>

          <div
            className="text-body"
            role="tabpanel"
            id={`${textIds}-contract-panel`}
            aria-label="Vertrag"
            hidden={textTab !== 'contract'}
          >
            <TextEditor
              label="Vertragstext"
              value={form.contractText}
              hint="Der Beförderungsvertrag, den der Gast liest und unterschreibt."
              error={emptyText === 'contractText' ? EMPTY_TEXT_ERRORS.contractText : undefined}
              onChange={(next) => edit('contractText', next)}
              inputRef={fieldRef('contractText')}
            />
          </div>
        </section>
      </div>

      <div className="save-bar">
        {/*
          Always mounted, even with nothing to say: a live region has to be in
          the accessibility tree before its text changes, or the change is not
          announced. Saving leaves focus on the button that did it, so this is
          the only thing that tells a screen reader the save happened.
        */}
        <div className="save-feedback" role="status" aria-live="polite">
          {error && <p className="error">{error}</p>}
          {saved && !error && <p className="hint">Gespeichert.</p>}
          {dirty && !error && <p className="unsaved">Ungespeicherte Änderungen</p>}
        </div>
        {dirty && (
          <button type="button" className="btn secondary" onClick={discard} disabled={saving}>
            Verwerfen
          </button>
        )}
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Speichert…' : 'Einstellungen speichern'}
        </button>
      </div>
    </div>
  )
}
