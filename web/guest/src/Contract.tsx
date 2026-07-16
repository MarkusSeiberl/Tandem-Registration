import { useEffect, useState } from 'react'
import { getContract } from './api'

export interface ContractProps {
  onNext: () => void
  onCancel?: () => void
}

export default function Contract({ onNext, onCancel }: ContractProps) {
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    let cancelled = false
    getContract()
      .then((t) => {
        if (!cancelled) setText(t)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Vertragstext konnte nicht geladen werden.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="screen contract-screen">
      <h1>Teilnahmebedingungen</h1>
      <div className="contract-text" role="region" aria-label="Teilnahmebedingungen">
        {loading && <p>Lade Vertragstext…</p>}
        {!loading && loadError && <p className="error">{loadError}</p>}
        {!loading && !loadError && text.trim().length === 0 && (
          <p>Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.</p>
        )}
        {!loading && !loadError && text.trim().length > 0 && (
          <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
        )}
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
        />
        Ich akzeptiere die Bedingungen
      </label>

      <div className="actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button type="button" className="btn primary" disabled={!accepted} onClick={onNext}>
          Weiter
        </button>
      </div>
    </section>
  )
}
