import { useEffect, useState } from 'react'
import { getSettings, putSettings } from './api'
import type { Payouts, Prices } from './api'

// Every amount the manifest can charge, in the order the screen shows them.
// `key` matches the Config.prices field the server validates.
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

type Field<T> = { key: keyof T; label: string }

// Turns the typed strings of one block back into numbers, refusing anything that
// would silently save as 0 €.
function toAmounts<T extends Record<keyof T, number>>(
  fields: Field<T>[],
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
  fields: Field<T>[],
  values: T
): Record<keyof T, string> {
  const out = {} as Record<keyof T, string>
  for (const { key } of fields) out[key] = String(values[key])
  return out
}

interface AmountFieldsProps<T> {
  title: string
  hint: string
  fields: Field<T>[]
  inputs: Record<keyof T, string>
  onChange: (key: keyof T, value: string) => void
}

function AmountFields<T>({ title, hint, fields, inputs, onChange }: AmountFieldsProps<T>) {
  return (
    <section className="amount-block">
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      {fields.map(({ key, label }) => (
        <label className="field" key={String(key)}>
          {label}
          <input
            type="number"
            className="numeral"
            min="0"
            step="1"
            value={inputs[key]}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </label>
      ))}
    </section>
  )
}

// Prices and payout rates, edited together: both are per-jump amounts the club
// sets once a season, and both live beside the crew they apply to rather than
// among the directory settings.
export default function Betraege() {
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

  function apply(cfg: { prices?: Prices; payouts?: Payouts }) {
    setPriceInputs(toInputs(PRICE_FIELDS, cfg.prices ?? EMPTY_PRICES))
    setPayoutInputs(toInputs(PAYOUT_FIELDS, cfg.payouts ?? EMPTY_PAYOUTS))
  }

  useEffect(() => {
    getSettings()
      .then(apply)
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
      // Only the two blocks travel: the server merges them into the stored config,
      // so the export directory saved on the settings screen stays untouched.
      const cfg = await putSettings({ prices, payouts })
      apply(cfg)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Lädt…</p>

  return (
    <section className="betraege-section">
      <AmountFields
        title="Preise (EUR)"
        hint="Gilt für neu berechnete Preise. Bereits gespeicherte Registrierungen behalten ihren Preis."
        fields={PRICE_FIELDS}
        inputs={priceInputs}
        onChange={(key, value) => {
          setPriceInputs((prev) => ({ ...prev, [key]: value }))
          setSaved(false)
        }}
      />

      <AmountFields
        title="Vergütung (EUR)"
        hint="Wird pro Sprung abgerechnet und erscheint im Excel-Export als eigener Block."
        fields={PAYOUT_FIELDS}
        inputs={payoutInputs}
        onChange={(key, value) => {
          setPayoutInputs((prev) => ({ ...prev, [key]: value }))
          setSaved(false)
        }}
      />

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="actions">
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Beträge speichern'}
        </button>
      </div>
    </section>
  )
}
