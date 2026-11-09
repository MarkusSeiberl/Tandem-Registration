import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { dayClose, exportDay, saveDayClose } from '../api'
import type { CollectedVia, ExportProgress, ExportResult, Registration } from '../api'
import { useExportProgress } from '../useEvents'
import ExportDone from './ExportDone'
import ExportRunning from './ExportRunning'
import CheckIcon from '../CheckIcon'
import CloseIcon from '../CloseIcon'
import AlertIcon from './AlertIcon'
import {
  difference, expectedTills, formatAmountInput, groupTandems, needsReason, openCount, parseAmount,
} from './cashMath'
import { formatClosedAt, formatLongDate, formatSigned, plural } from './format'
import StepCash, { type CashInputs } from './StepCash'
import StepManager from './StepManager'
import StepSummary from './StepSummary'
import StepTandems from './StepTandems'

export interface DayCloseDialogProps {
  date: string
  /** Live from List, so a row collected on another tablet updates the steps. */
  rows: Registration[]
  masterNames: Map<number, string>
  /** The day's one Betriebsleiter value, shared with the toolbar field. */
  manager: string
  onManagerChange: (name: string) => void
  /** List's own save; answers whether the name is safe on the server. */
  saveManager: () => Promise<boolean>
  /** Collects a row or names its till; throws with a message on failure. */
  settleRow: (row: Registration, method: CollectedVia | null) => Promise<void>
  onClose: () => void
}

type StepId = 'tandems' | 'cash' | 'manager' | 'summary'
const STEPS: { id: StepId; label: string }[] = [
  { id: 'tandems', label: 'Tandems' },
  { id: 'cash', label: 'Kasse' },
  { id: 'manager', label: 'Betriebsleiter' },
  { id: 'summary', label: 'Abschluss' },
]

type Marker = 'todo' | 'current' | 'done' | 'warn' | 'failed'

// The server's own wording for a day another PC is closing right now.
const ALREADY_RUNNING = 'Tagesabschluss läuft bereits'

function newRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function DayCloseDialog({
  date, rows, masterNames, manager, onManagerChange, saveManager, settleRow, onClose,
}: DayCloseDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [inputs, setInputs] = useState<CashInputs>({ cash: '', card: '', note: '' })
  // Typed since the draft was last saved or loaded; only then is closing
  // worth a write.
  const dirty = useRef(false)
  const [closedAt, setClosedAt] = useState<string | null>(null)
  const [cashMessage, setCashMessage] = useState<string | null>(null)
  const [managerMessage, setManagerMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The export run: its id while it runs, its answer once it succeeded, its
  // failure for the summary to show. `starting` guards the button against a
  // second press before React has re-rendered it disabled.
  const [runId, setRunId] = useState<string | null>(null)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const starting = useRef(false)
  const running = runId !== null
  const locked = busy || running
  const step = STEPS[stepIndex].id

  useExportProgress(runId, setProgress)

  // Mount-only, like CollectDialog: List unmounts this to close it.
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  useEffect(() => {
    let stale = false
    dayClose(date)
      .then((state) => {
        if (stale) return
        setClosedAt(state.exportedAt)
        // An operator who already typed wins over a draft that arrived late.
        if (dirty.current) return
        setInputs({
          cash: formatAmountInput(state.countedCash),
          card: formatAmountInput(state.countedCard),
          note: state.note,
        })
      })
      .catch((err: unknown) => {
        if (!stale) setCashMessage(err instanceof Error ? err.message : 'Kassensturz konnte nicht geladen werden')
      })
    return () => { stale = true }
  }, [date])

  const expected = expectedTills(rows)
  const groups = groupTandems(rows)
  const open = openCount(rows)
  const parsed = { cash: parseAmount(inputs.cash), card: parseAmount(inputs.card) }
  const invalid = parsed.cash === 'invalid' || parsed.card === 'invalid'
  const counted = {
    cash: parsed.cash === 'invalid' ? null : parsed.cash,
    card: parsed.card === 'invalid' ? null : parsed.card,
  }
  const reasonMissing = needsReason(counted, expected) && inputs.note.trim() === ''
  const managerMissing = manager.trim() === ''

  function changeInputs(next: CashInputs) {
    dirty.current = true
    setInputs(next)
  }

  /**
   * Writes the Kassensturz draft. Answers null once it is safe on the server,
   * or why it is not.
   */
  async function saveDraft(force: boolean): Promise<string | null> {
    if (!force && !dirty.current) return null
    if (invalid) return 'Betrag ungültig'
    try {
      await saveDayClose(date, { countedCash: counted.cash, countedCard: counted.card, note: inputs.note.trim() })
      dirty.current = false
      setCashMessage(null)
      return null
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Kassensturz speichern fehlgeschlagen'
      setCashMessage(message)
      return message
    }
  }

  async function goTo(index: number) {
    if (step === 'cash' && (await saveDraft(true)) !== null) return
    setStepIndex(index)
  }

  async function handleNext() {
    if (step === 'manager') {
      setBusy(true)
      const saved = await saveManager()
      setBusy(false)
      if (!saved) {
        setManagerMessage('Betriebsleiter konnte nicht gespeichert werden.')
        return
      }
      setManagerMessage(null)
    }
    await goTo(stepIndex + 1)
  }

  async function close() {
    if (result === null) await saveDraft(false)
    onClose()
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // The dialog closes by being unmounted, never by the browser on its own.
    event.preventDefault()
    if (locked) return
    void close()
  }

  async function runExport() {
    if (starting.current) return
    starting.current = true
    setExportError(null)
    try {
      // "Kassensturz gespeichert" is this write: the sheet is built from what
      // the server has, so it has to have exactly what stands in the fields.
      const saveFailure = await saveDraft(true)
      if (saveFailure !== null) {
        setExportError(saveFailure)
        return
      }
      const id = newRunId()
      setProgress(null)
      setRunId(id)
      try {
        setResult(await exportDay(date, id))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Export fehlgeschlagen'
        setExportError(message === ALREADY_RUNNING ? `${ALREADY_RUNNING} (anderer Rechner).` : message)
      } finally {
        setRunId(null)
      }
    } finally {
      starting.current = false
    }
  }

  // --- the rail: each step's marker and one line of what it holds ---------
  const tandemWork = open + groups.noMethod.length
  function status(id: StepId): string {
    switch (id) {
      case 'tandems': {
        if (tandemWork === 0) return 'Alles kassiert'
        if (stepIndex > 0) return `${open} ${plural(open, 'bleibt', 'bleiben')} offen`
        const parts = []
        if (open > 0) parts.push(`${open} offen`)
        if (groups.noMethod.length > 0) parts.push(`${groups.noMethod.length} ohne Zahlungsart`)
        return parts.join(' · ')
      }
      case 'cash': {
        if (stepIndex < 1) return ''
        const diffs = (['cash', 'card'] as const)
          .map((t) => ({ t, d: difference(counted[t], expected[t]) }))
          .filter(({ d }) => d !== null && d !== 0)
          .map(({ t, d }) => `${t === 'cash' ? 'Bar' : 'Karte'} ${formatSigned(d!)}`)
        if (counted.cash === null && counted.card === null) return 'nicht gezählt'
        if (diffs.length === 0) return 'stimmt'
        return inputs.note.trim() !== '' ? `${diffs.join(' · ')} · begründet` : `Differenz ${diffs.join(' · ')}`
      }
      case 'manager':
        if (stepIndex < 2) return ''
        return managerMissing ? 'fehlt noch' : manager.trim()
      case 'summary':
        if (result !== null) return 'Abgeschlossen'
        if (running) return 'läuft …'
        if (exportError !== null) return 'Fehlgeschlagen'
        return ''
    }
  }
  function marker(index: number): Marker {
    if (STEPS[index].id === 'summary' && result !== null) return 'done'
    if (STEPS[index].id === 'summary' && exportError !== null && !running) return 'failed'
    if (index === stepIndex) return 'current'
    if (index > stepIndex) return 'todo'
    if (STEPS[index].id === 'tandems' && open > 0) return 'warn'
    return 'done'
  }

  const finished = result !== null
  const nextDisabled = locked ||
    (step === 'cash' && (invalid || reasonMissing)) ||
    (step === 'manager' && managerMissing)

  return (
    <dialog ref={ref} className="dc" aria-labelledby="dc-title" onCancel={handleCancel}>
      <header className="dc-head">
        <h2 id="dc-title">Tagesabschluss</h2>
        <span className="dc-date">{formatLongDate(date)}</span>
        {/* Once the day is closed the footer's Schließen is the only way out;
            a second button of the same name would only make the reader ask
            which one. */}
        {!finished && (
          <button type="button" className="dc-x" aria-label="Schließen" disabled={locked} onClick={() => void close()}>
            <CloseIcon size={20} />
          </button>
        )}
      </header>
      {closedAt && (
        <div className="dc-closed">
          <CheckIcon size={16} />
          Bereits abgeschlossen am {formatClosedAt(closedAt)} · erneut abschließen überschreibt das Blatt.
          Die Werte von damals sind eingesetzt.
        </div>
      )}
      <ol className="dc-rail" aria-label="Schritte">
        {STEPS.map((s, i) => {
          const m = marker(i)
          const reachable = i < stepIndex && !locked && !finished
          return (
            <li key={s.id} className={i === stepIndex ? `current ${m}` : m}>
              <button
                type="button"
                className="dc-step"
                disabled={!reachable && i !== stepIndex}
                aria-current={i === stepIndex ? 'step' : undefined}
                onClick={() => { if (reachable) void goTo(i) }}
              >
                <span className="dc-marker" aria-hidden="true">
                  {m === 'done' ? <CheckIcon size={16} /> : m === 'warn' || m === 'failed' ? <AlertIcon /> : i + 1}
                </span>
                <span className="dc-step-label">{s.label}</span>
                <span className="dc-step-status">{status(s.id) || ' '}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <div className="dc-pane">
        <div className="dc-body">
          {step === 'tandems' && (
            <StepTandems rows={rows} masterNames={masterNames} settleRow={settleRow} disabled={locked} />
          )}
          {step === 'cash' && (
            <StepCash
              inputs={inputs}
              expected={expected}
              onChange={changeInputs}
              onFieldBlur={() => void saveDraft(false)}
              message={cashMessage}
              disabled={locked}
            />
          )}
          {step === 'manager' && (
            <StepManager manager={manager} onManagerChange={onManagerChange} message={managerMessage} disabled={locked} />
          )}
          {step === 'summary' && running && <ExportRunning progress={progress} />}
          {step === 'summary' && finished && (
            <ExportDone
              date={date}
              result={result}
              diffs={{ cash: difference(counted.cash, expected.cash), card: difference(counted.card, expected.card) }}
              note={inputs.note}
              openLeft={open}
            />
          )}
          {step === 'summary' && !running && !finished && (
            <StepSummary
              rows={rows}
              manager={manager}
              counted={counted}
              expected={expected}
              note={inputs.note}
              error={exportError}
              onGoToTandems={() => setStepIndex(0)}
            />
          )}
        </div>
        <footer className="dc-foot">
          {finished ? (
            <>
              <span className="dc-spacer" />
              <button type="button" className="btn primary" onClick={onClose}>Schließen</button>
            </>
          ) : (
            <>
              {stepIndex > 0 && (
                <button type="button" className="btn secondary" disabled={locked}
                  onClick={() => void goTo(stepIndex - 1)}>
                  Zurück
                </button>
              )}
              <span className="dc-spacer" />
              {step === 'manager' && managerMissing && <span className="dc-foot-note">Name fehlt</span>}
              <button type="button" className="btn secondary" disabled={locked} onClick={() => void close()}>
                Abbrechen
              </button>
              {step !== 'summary' ? (
                <button type="button" className="btn primary" disabled={nextDisabled}
                  onClick={() => void handleNext()}>
                  Weiter
                </button>
              ) : (
                <button type="button" className="btn primary" disabled={locked} onClick={() => void runExport()}>
                  {running ? 'Wird abgeschlossen …' : exportError !== null ? 'Erneut versuchen' : 'Tagesabschluss durchführen'}
                </button>
              )}
            </>
          )}
        </footer>
      </div>
    </dialog>
  )
}
