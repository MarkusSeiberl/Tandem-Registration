import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import { dayClose, saveDayClose } from '../api'
import type { CollectedVia, Registration } from '../api'
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

type Marker = 'todo' | 'current' | 'done' | 'warn'

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
  const step = STEPS[stepIndex].id

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

  /** Writes the Kassensturz draft. Answers whether it is safe on the server. */
  async function saveDraft(force: boolean): Promise<boolean> {
    if (!force && !dirty.current) return true
    if (invalid) return false
    try {
      await saveDayClose(date, { countedCash: counted.cash, countedCard: counted.card, note: inputs.note.trim() })
      dirty.current = false
      setCashMessage(null)
      return true
    } catch (err) {
      setCashMessage(err instanceof Error ? err.message : 'Kassensturz speichern fehlgeschlagen')
      return false
    }
  }

  async function goTo(index: number) {
    if (step === 'cash' && !(await saveDraft(true))) return
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
    await saveDraft(false)
    onClose()
  }

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // The dialog closes by being unmounted, never by the browser on its own.
    event.preventDefault()
    if (busy) return
    void close()
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
        return ''
    }
  }
  function marker(index: number): Marker {
    if (index === stepIndex) return 'current'
    if (index > stepIndex) return 'todo'
    if (STEPS[index].id === 'tandems' && open > 0) return 'warn'
    return 'done'
  }

  const nextDisabled = busy ||
    (step === 'cash' && (invalid || reasonMissing)) ||
    (step === 'manager' && managerMissing)

  return (
    <dialog ref={ref} className="dc" aria-labelledby="dc-title" onCancel={handleCancel}>
      <header className="dc-head">
        <h2 id="dc-title">Tagesabschluss</h2>
        <span className="dc-date">{formatLongDate(date)}</span>
        <button type="button" className="dc-x" aria-label="Schließen" disabled={busy} onClick={() => void close()}>
          <CloseIcon size={20} />
        </button>
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
          const reachable = i < stepIndex && !busy
          return (
            <li key={s.id} className={m}>
              <button
                type="button"
                className="dc-step"
                disabled={!reachable && i !== stepIndex}
                aria-current={i === stepIndex ? 'step' : undefined}
                onClick={() => { if (reachable) void goTo(i) }}
              >
                <span className="dc-marker" aria-hidden="true">
                  {m === 'done' ? <CheckIcon size={16} /> : m === 'warn' ? <AlertIcon /> : i + 1}
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
            <StepTandems rows={rows} masterNames={masterNames} settleRow={settleRow} disabled={busy} />
          )}
          {step === 'cash' && (
            <StepCash
              inputs={inputs}
              expected={expected}
              onChange={changeInputs}
              onFieldBlur={() => void saveDraft(false)}
              message={cashMessage}
              disabled={busy}
            />
          )}
          {step === 'manager' && (
            <StepManager manager={manager} onManagerChange={onManagerChange} message={managerMessage} disabled={busy} />
          )}
          {step === 'summary' && (
            <StepSummary
              rows={rows}
              manager={manager}
              counted={counted}
              expected={expected}
              note={inputs.note}
              error={null}
              onGoToTandems={() => setStepIndex(0)}
            />
          )}
        </div>
        <footer className="dc-foot">
          {stepIndex > 0 && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void goTo(stepIndex - 1)}>
              Zurück
            </button>
          )}
          <span className="dc-spacer" />
          {step === 'manager' && managerMissing && <span className="dc-foot-note">Name fehlt</span>}
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void close()}>
            Abbrechen
          </button>
          {step !== 'summary' ? (
            <button type="button" className="btn primary" disabled={nextDisabled} onClick={() => void handleNext()}>
              Weiter
            </button>
          ) : (
            <button type="button" className="btn primary" disabled={busy}>
              Tagesabschluss durchführen
            </button>
          )}
        </footer>
      </div>
    </dialog>
  )
}
