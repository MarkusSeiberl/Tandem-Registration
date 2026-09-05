import { useEffect, useRef, useState } from 'react'
import type { SyntheticEvent } from 'react'
import type { CollectedVia, Registration } from './api'
import { COLLECTED_VIA } from './labels'
import { formatEuro } from './pricing'

export interface CollectDialogProps {
  /** Die ausgewählten Zeilen, die noch offen sind. Nie leer. */
  rows: Registration[]
  /** Angehakte Zeilen, die schon kassiert sind — die Aktion lässt sie in Ruhe. */
  skippedCount: number
  /** Läuft die Schleife gerade. Sperrt alles, damit Escape nicht mitten hineinfährt. */
  busy: boolean
  error: string | null
  onConfirm: (method: CollectedVia) => void
  onCancel: () => void
}

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
  const zeroCount = rows.filter((r) => (r.price ?? 0) <= 0).length

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
      <p>
        Offener Betrag: <span className="numeral">{formatEuro(sum)}</span>
      </p>
      {skippedCount > 0 && (
        <p>
          {skippedCount === 1
            ? '1 bereits kassierte Zeile bleibt unverändert.'
            : `${skippedCount} bereits kassierte Zeilen bleiben unverändert.`}
        </p>
      )}
      {zeroCount > 0 && (
        <p>
          {zeroCount === 1
            ? '1 Tandem ohne Restbetrag behält seine Zahlungsart.'
            : `${zeroCount} Tandems ohne Restbetrag behalten ihre Zahlungsart.`}
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
      {error && <p className="error">{error}</p>}
      <div className="collect-dialog-actions">
        <button type="button" className="btn secondary" onClick={onCancel} disabled={busy}>
          Abbrechen
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => method && onConfirm(method)}
          disabled={busy || method === ''}
        >
          {busy ? 'Wird kassiert…' : 'Kassieren'}
        </button>
      </div>
    </dialog>
  )
}
