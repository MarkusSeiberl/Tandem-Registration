import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { getSettings, putSettings } from './api'
import type { Payouts, Prices } from './api'
import PriceMatrix from './PriceMatrix'
import { formatEuro } from './pricing'

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
  { key: 'video', label: 'Kameraflieger Video' },
  { key: 'video_photo', label: 'Kameraflieger Video + Foto' },
  { key: 'weight_over_90', label: 'Tandemmaster Zuschlag ab 90 kg' },
  { key: 'weight_over_100', label: 'Tandemmaster Zuschlag ab 100 kg' },
]

type Field<T> = { key: keyof T; label: string }
type Inputs<T> = Record<keyof T, string>

const AMOUNT = /^\d+(?:[.,]\d{1,2})?$/

// What is wrong with a typed amount, in the words the field shows, or null
// when it is a valid one. Named per rule: "ungültig" alone leaves the operator
// guessing whether the minus, the third decimal or the euro sign was the issue.
function amountProblem(raw: string): string | null {
  const text = raw.trim()
  if (AMOUNT.test(text)) return null
  if (text === '') return 'Betrag fehlt.'
  if (text.startsWith('-')) return 'Kein Minus – Beträge ab 0.'
  // "1.000" is a thousands point to some and a third decimal to the parser;
  // either way it is not an amount this field takes.
  if (/^\d+[.,]\d{3,}$/.test(text)) return 'Höchstens zwei Nachkommastellen.'
  return 'Nur Ziffern, z. B. 280 oder 12,50.'
}

// Whole euros, or euros and cents with a comma or a point. Anything else is
// null rather than a guess: it would otherwise save as 0 € or as an amount
// nobody typed. Shared by saving (which refuses), the fields (which say why)
// and the live table (which blanks).
function parseAmount(raw: string): number | null {
  return amountProblem(raw) === null ? Number(raw.trim().replace(',', '.')) : null
}

// The way the price list writes an amount: "270", or "12,50" with cents.
function amountText(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace('.', ',')
}

function toInputs<T extends Record<keyof T, number>>(fields: Field<T>[], values: T): Inputs<T> {
  const out = {} as Inputs<T>
  for (const { key } of fields) out[key] = amountText(values[key])
  return out
}

// Only called once every field parses (see invalidKeys).
function toAmounts<T extends Record<keyof T, number>>(fields: Field<T>[], inputs: Inputs<T>): T {
  const out = {} as T
  for (const { key } of fields) out[key] = parseAmount(inputs[key]) as T[keyof T]
  return out
}

// The amounts as typed right now, minus the ones that do not parse. Feeds the
// final price table, which shows what saving would charge.
function liveAmounts<T>(fields: Field<T>[], inputs: Inputs<T>): Partial<Record<keyof T, number>> {
  const out: Partial<Record<keyof T, number>> = {}
  for (const { key } of fields) {
    const value = parseAmount(inputs[key])
    if (value !== null) out[key] = value
  }
  return out
}

// A field counts as changed when it no longer holds the saved amount — typing
// "270,00" over "270" is no change, a field emptied while retyping is one.
function isChanged(current: string, saved: string): boolean {
  const now = parseAmount(current)
  return now === null || now !== parseAmount(saved)
}

interface AmountFieldsProps<T> {
  title: string
  hint: string
  fields: Field<T>[]
  inputs: Inputs<T>
  saved: Inputs<T>
  // Fields to report as invalid: left once, or all of them after a refused save.
  shownInvalid: Set<keyof T>
  onChange: (key: keyof T, value: string) => void
  onLeave: (key: keyof T) => void
  inputRef: (key: keyof T, el: HTMLInputElement | null) => void
  // Shown beside the fields, under the block's heading: the final prices next
  // to the prices they are built from.
  aside?: ReactNode
}

function AmountFields<T>({
  title, hint, fields, inputs, saved, shownInvalid, onChange, onLeave, inputRef, aside,
}: AmountFieldsProps<T>) {
  const ids = useId()
  return (
    <section className="amount-block">
      <h3>{title}</h3>
      <p className="amount-hint">{hint}</p>
      <div className="amount-body">
        <div className="amount-fields">
          {fields.map(({ key, label }) => {
            const invalid = shownInvalid.has(key)
            const previous = parseAmount(saved[key])
            const changed = isChanged(inputs[key], saved[key]) && previous !== null
            const errorId = `${ids}-${String(key)}-error`
            const previousId = `${ids}-${String(key)}-previous`
            const inputId = `${ids}-${String(key)}`
            const describedBy = [invalid && errorId, changed && previousId].filter(Boolean).join(' ')
            // A div with a label pointing at the input, not a wrapping label: the
            // label's text is the field's name, and the € sign, the error and the
            // old amount below it are not part of that name.
            return (
              <div className="field" key={String(key)}>
                <label htmlFor={inputId}>{label}</label>
                <span className="amount-input">
                  {/* Text with a decimal keypad, not type="number": a number field
                      turns a scroll of the mouse wheel or an arrow key into a new
                      price, silently, on a page that has to be scrolled. */}
                  <input
                    id={inputId}
                    ref={(el) => inputRef(key, el)}
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="numeral"
                    value={inputs[key]}
                    aria-invalid={invalid}
                    aria-describedby={describedBy || undefined}
                    onChange={(e) => onChange(key, e.target.value)}
                    onBlur={() => onLeave(key)}
                  />
                  <span className="amount-unit" aria-hidden="true">€</span>
                </span>
                {invalid && <span className="field-error" id={errorId}>{amountProblem(inputs[key])}</span>}
                {changed && <span className="field-hint" id={previousId}>vorher {formatEuro(previous)}</span>}
              </div>
            )
          })}
        </div>
        {aside}
      </div>
    </section>
  )
}

const EMPTY_PRICE_INPUTS: Inputs<Prices> = {
  jump: '', video: '', video_photo: '', weight_over_90: '', weight_over_100: '',
}
const EMPTY_PAYOUT_INPUTS: Inputs<Payouts> = {
  tandem_master: '', video: '', video_photo: '', weight_over_90: '', weight_over_100: '',
}

interface BetraegeProps {
  // Told whenever unsaved edits appear or go, so the app can ask before a tab
  // switch or a closed window throws them away.
  onDirtyChange?: (dirty: boolean) => void
}

// Prices and payout rates, edited together: both are per-jump amounts the club
// sets once a season. Lives on the Tarife screen, apart from the directory
// settings.
export default function Betraege({ onDirtyChange }: BetraegeProps) {
  const [priceInputs, setPriceInputs] = useState(EMPTY_PRICE_INPUTS)
  const [payoutInputs, setPayoutInputs] = useState(EMPTY_PAYOUT_INPUTS)
  // What the server holds, as text in the same shape: the baseline every
  // "changed", "vorher" and "Verwerfen" is measured against.
  const [savedPrices, setSavedPrices] = useState(EMPTY_PRICE_INPUTS)
  const [savedPayouts, setSavedPayouts] = useState(EMPTY_PAYOUT_INPUTS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // An amount is only called wrong once its field was left, or after a save
  // was refused: an emptied field is usually about to be retyped.
  const [leftFields, setLeftFields] = useState<Set<string>>(new Set())
  const [saveAttempted, setSaveAttempted] = useState(false)
  const fieldRefs = useRef(new Map<string, HTMLInputElement>())

  function apply(cfg: { prices?: Prices; payouts?: Payouts }) {
    const prices = cfg.prices ? toInputs(PRICE_FIELDS, cfg.prices) : EMPTY_PRICE_INPUTS
    const payouts = cfg.payouts ? toInputs(PAYOUT_FIELDS, cfg.payouts) : EMPTY_PAYOUT_INPUTS
    setPriceInputs(prices)
    setPayoutInputs(payouts)
    setSavedPrices(prices)
    setSavedPayouts(payouts)
    setLeftFields(new Set())
    setSaveAttempted(false)
  }

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    getSettings()
      .then(apply)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const dirty =
    PRICE_FIELDS.some(({ key }) => isChanged(priceInputs[key], savedPrices[key])) ||
    PAYOUT_FIELDS.some(({ key }) => isChanged(payoutInputs[key], savedPayouts[key]))

  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])
  // Leaving the screen leaves nothing unsaved behind it.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const invalidPrices = PRICE_FIELDS.filter(({ key }) => parseAmount(priceInputs[key]) === null)
  const invalidPayouts = PAYOUT_FIELDS.filter(({ key }) => parseAmount(payoutInputs[key]) === null)
  const shown = <T,>(invalid: Field<T>[], block: string) =>
    new Set(
      invalid
        .filter(({ key }) => saveAttempted || leftFields.has(`${block}.${String(key)}`))
        .map(({ key }) => key)
    )

  async function handleSave() {
    setError(null)
    setSaved(false)
    if (invalidPrices.length > 0 || invalidPayouts.length > 0) {
      setSaveAttempted(true)
      const first = invalidPrices[0]
        ? `prices.${String(invalidPrices[0].key)}`
        : `payouts.${String(invalidPayouts[0].key)}`
      fieldRefs.current.get(first)?.focus()
      return
    }
    setSaving(true)
    try {
      // Only the two blocks travel: the server merges them into the stored config,
      // so the export directory saved on the settings screen stays untouched.
      const cfg = await putSettings({
        prices: toAmounts(PRICE_FIELDS, priceInputs),
        payouts: toAmounts(PAYOUT_FIELDS, payoutInputs),
      })
      apply(cfg)
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
    const price = PRICE_FIELDS.find(({ key }) => isChanged(priceInputs[key], savedPrices[key]))
    const payout = PAYOUT_FIELDS.find(({ key }) => isChanged(payoutInputs[key], savedPayouts[key]))
    const first = price ? `prices.${String(price.key)}` : payout ? `payouts.${String(payout.key)}` : null
    if (first) fieldRefs.current.get(first)?.focus()
    setPriceInputs(savedPrices)
    setPayoutInputs(savedPayouts)
    setLeftFields(new Set())
    setSaveAttempted(false)
    setError(null)
  }

  if (loading) return <p className="field-hint">Lädt…</p>

  // No form without the saved amounts: an empty one saved by mistake would
  // set every price and payout to nothing.
  if (loadError) {
    return (
      <div className="load-failed">
        <p className="error">Tarife konnten nicht geladen werden: {loadError}</p>
        <button type="button" className="btn secondary" onClick={load}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  const blockProps = (block: 'prices' | 'payouts') => ({
    onLeave: (key: PropertyKey) =>
      setLeftFields((prev) => new Set(prev).add(`${block}.${String(key)}`)),
    inputRef: (key: PropertyKey, el: HTMLInputElement | null) => {
      const id = `${block}.${String(key)}`
      if (el) fieldRefs.current.set(id, el)
      else fieldRefs.current.delete(id)
    },
  })

  const invalidShown = saveAttempted && (invalidPrices.length > 0 || invalidPayouts.length > 0)

  return (
    <section className="betraege-section">
      {/* The final prices sit under the inputs they are built from, so the
          screen stays two columns: what the guest pays, what the club pays. */}
      <div className="price-column">
        <AmountFields
          title="Preise (EUR)"
          hint="Gilt ab dem nächsten Sprungtag. Laufende und abgeschlossene Tage behalten ihre Preise."
          fields={PRICE_FIELDS}
          inputs={priceInputs}
          saved={savedPrices}
          shownInvalid={shown(invalidPrices, 'prices')}
          onChange={(key, value) => {
            setPriceInputs((prev) => ({ ...prev, [key]: value }))
            setSaved(false)
          }}
          {...blockProps('prices')}
          aside={
            <PriceMatrix
              prices={liveAmounts(PRICE_FIELDS, priceInputs)}
              before={dirty ? liveAmounts(PRICE_FIELDS, savedPrices) : undefined}
            />
          }
        />
      </div>

      <AmountFields
        title="Vergütung (EUR)"
        hint="Pro Sprung, eigener Block im Excel-Export. Gilt ebenfalls ab dem nächsten Sprungtag."
        fields={PAYOUT_FIELDS}
        inputs={payoutInputs}
        saved={savedPayouts}
        shownInvalid={shown(invalidPayouts, 'payouts')}
        onChange={(key, value) => {
          setPayoutInputs((prev) => ({ ...prev, [key]: value }))
          setSaved(false)
        }}
        {...blockProps('payouts')}
      />

      {/* Sticky like the one on Einstellungen: on a laptop screen the button
          would otherwise sit below the fold, out of sight of the change. */}
      <div className="save-bar">
        {/* Always mounted: a live region has to exist before its text changes,
            or the change is not announced. */}
        <div className="save-feedback" role="status" aria-live="polite">
          {invalidShown && <p className="error">Bitte die markierten Beträge prüfen.</p>}
          {error && <p className="error">{error}</p>}
          {saved && !error && <p className="hint">Gespeichert. Gilt ab dem nächsten Sprungtag.</p>}
          {dirty && !invalidShown && !error && <p className="unsaved">Ungespeicherte Änderungen</p>}
        </div>
        {dirty && (
          <button type="button" className="btn secondary" onClick={discard} disabled={saving}>
            Verwerfen
          </button>
        )}
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? 'Speichert…' : 'Beträge speichern'}
        </button>
      </div>
    </section>
  )
}
