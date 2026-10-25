import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import type { CollectedVia, Registration } from './api'
import { COLLECTED_VIA } from './labels'
import { collectedVia, formatEuro } from './pricing'

export interface CollectDialogProps {
  /** The selected rows that are still open. Never empty. */
  rows: Registration[]
  /** Checked rows that are already collected — the run leaves them alone. */
  skippedCount: number
  /** The collect loop is running. Locks everything so Escape cannot cut into it. */
  busy: boolean
  error: string | null
  onConfirm: (method: CollectedVia) => void
  onCancel: () => void
}

const tillLabel = (via: CollectedVia) => COLLECTED_VIA.find((m) => m.value === via)?.label ?? ''

// Pure presentation: List (Task 3) owns the fetch loop and only mounts this
// once it has decided the dialog should be open, so there is no `open` prop
// and no `patch` import here.
export default function CollectDialog({
  rows, skippedCount, busy, error, onConfirm, onCancel,
}: CollectDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [method, setMethod] = useState<CollectedVia | ''>('')

  // Mount-only: List unmounts this component to close the dialog, so there is
  // nothing to react to on later renders, and no matching close() to call —
  // the jsdom stub from setupTests.ts does not dispatch a `close` event, so a
  // component built around one would just sit there in tests.
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Escape fires the dialog's native cancel event even while a collect loop
    // is mid-flight; busy means the parent is between PATCH calls and cannot
    // safely be torn down, so the event is swallowed instead of closing it.
    if (busy) {
      event.preventDefault()
      return
    }
    onCancel()
  }

  const sum = rows.reduce((s, r) => s + (r.price ?? 0), 0)
  // The run writes the chosen method to every row that owes money, over
  // whatever till it already names (List.runCollect). That is the intended
  // rule; what this dialog adds is that nobody has to find out at closing.
  const owes = (r: Registration) => (r.price ?? 0) > 0
  const overwritten = (r: Registration) => {
    const current = collectedVia(r)
    return method !== '' && owes(r) && current !== null && current !== method
  }
  const changeCount = rows.filter(overwritten).length

  return (
    <dialog
      ref={ref}
      className="collect-dialog"
      onCancel={handleCancel}
      aria-labelledby="collect-dialog-title"
    >
      <h2 id="collect-dialog-title">
        {rows.length === 1 ? '1 Tandem kassieren' : `${rows.length} Tandems kassieren`}
      </h2>
      <ul className="collect-rows" aria-label="Tandems in diesem Lauf">
        {rows.map((r) => {
          const current = collectedVia(r)
          return (
            <li key={r.id} className={overwritten(r) ? 'collect-row changed' : 'collect-row'}>
              <span className="collect-row-name">{r.first_name} {r.last_name}</span>
              <span className="collect-row-till">
                {!owes(r)
                  ? 'ohne Restbetrag'
                  : overwritten(r)
                    ? `${tillLabel(current!)} → ${tillLabel(method as CollectedVia)}`
                    : current !== null ? tillLabel(current) : ''}
              </span>
              <span className="collect-row-price numeral">{formatEuro(r.price ?? 0)}</span>
            </li>
          )
        })}
      </ul>
      <p className="collect-sum">
        Offener Betrag: <span className="numeral">{formatEuro(sum)}</span>
      </p>
      {skippedCount > 0 && (
        <p>
          {skippedCount === 1
            ? '1 bereits kassierte Zeile bleibt unverändert.'
            : `${skippedCount} bereits kassierte Zeilen bleiben unverändert.`}
        </p>
      )}
      <label>
        Zahlungsart
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as CollectedVia | '')}
          disabled={busy}
        >
          <option value="">– bitte wählen –</option>
          {COLLECTED_VIA.map((m) => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </label>
      <p className="collect-change-note" aria-live="polite">
        {changeCount === 0
          ? ''
          : changeCount === 1
            ? '1 Zahlungsart wird geändert.'
            : `${changeCount} Zahlungsarten werden geändert.`}
      </p>
      {error && <p className="error">{error}</p>}
      <div className="collect-dialog-actions">
        <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => method && onConfirm(method)}
          disabled={busy || method === '' || rows.length === 0}
        >
          {busy ? 'Wird kassiert…' : 'Kassieren'}
        </button>
      </div>
    </dialog>
  )
}
