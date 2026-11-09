import { difference, parseAmount } from './cashMath'
import { formatMoney, formatSigned } from './format'

export interface CashInputs {
  cash: string
  card: string
  note: string
}

export interface StepCashProps {
  inputs: CashInputs
  expected: { cash: number; card: number }
  onChange: (next: CashInputs) => void
  /** A field was left: the dialog saves the draft. */
  onFieldBlur: () => void
  /** Why the draft could not be loaded or saved; null when it could. */
  message: string | null
  disabled: boolean
}

type Till = 'cash' | 'card'
const TILL_LABEL: Record<Till, string> = { cash: 'Bar', card: 'Karte' }

/** Which tills a reason has to cover, for the label beside the field. */
function reasonFor(inputs: CashInputs, expected: { cash: number; card: number }): string | null {
  const off = (till: Till) => {
    const counted = parseAmount(inputs[till])
    return typeof counted === 'number' && (difference(counted, expected[till]) ?? 0) !== 0
  }
  if (off('cash') && off('card')) return 'Bar und Karte abweichen'
  if (off('cash')) return 'Bar abweicht'
  if (off('card')) return 'Karte abweicht'
  return null
}

function Difference({ till, input, expected }: { till: Till; input: string; expected: number }) {
  const counted = parseAmount(input)
  if (counted === 'invalid') return <span className="dc-diff none" data-testid={`diff-${till}`}>–</span>
  const diff = difference(counted, expected)
  if (diff === null) return <span className="dc-diff none" data-testid={`diff-${till}`}>nicht gezählt</span>
  if (diff === 0) {
    return <span className="dc-diff ok numeral" data-testid={`diff-${till}`}>{formatMoney(0)} <small>stimmt</small></span>
  }
  return (
    <span className="dc-diff off numeral" data-testid={`diff-${till}`}>
      {formatSigned(diff)} <small>{diff > 0 ? 'zu viel' : 'zu wenig'}</small>
    </span>
  )
}

export default function StepCash({ inputs, expected, onChange, onFieldBlur, message, disabled }: StepCashProps) {
  const reason = reasonFor(inputs, expected)
  const tills: Till[] = ['cash', 'card']
  return (
    <>
      <h3>Kassensturz</h3>
      <p className="dc-lede">
        Zähl die Kasse und lies die Tagessumme vom Kartenterminal ab. Leer lassen heißt: nicht gezählt.
      </p>
      {message && <p className="dc-message" role="alert">{message}</p>}
      <div className="dc-ledger">
        <span className="dc-hd" />
        {tills.map((t) => <span key={t} className="dc-hd dc-till">{TILL_LABEL[t]}</span>)}

        <span className="dc-lab">Erwartet</span>
        {tills.map((t) => (
          <span key={t} className="dc-val numeral" data-testid={`expected-${t}`}>{formatMoney(expected[t])}</span>
        ))}

        <span className="dc-lab">Gezählt</span>
        {tills.map((t) => {
          const invalid = parseAmount(inputs[t]) === 'invalid'
          return (
            <span key={t} className="dc-field-cell">
              <span className="dc-money">
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  aria-label={`Gezählt ${TILL_LABEL[t]}`}
                  aria-invalid={invalid || undefined}
                  value={inputs[t]}
                  disabled={disabled}
                  onChange={(e) => onChange({ ...inputs, [t]: e.target.value })}
                  onBlur={onFieldBlur}
                />
              </span>
              {invalid && <small className="dc-field-error">Betrag ungültig</small>}
            </span>
          )
        })}

        <span className="dc-lab">Differenz</span>
        {tills.map((t) => (
          <span key={t}><Difference till={t} input={inputs[t]} expected={expected[t]} /></span>
        ))}
      </div>
      {(reason !== null || inputs.note !== '') && (
        <div className="dc-reason">
          <label htmlFor="dc-reason">
            Begründung {reason !== null && <span>· nötig, weil {reason}</span>}
          </label>
          <textarea
            id="dc-reason"
            value={inputs.note}
            maxLength={500}
            disabled={disabled}
            onChange={(e) => onChange({ ...inputs, note: e.target.value })}
            onBlur={onFieldBlur}
          />
          <span className="dc-hint">Steht im Excel-Blatt unter Kassensturz.</span>
        </div>
      )}
    </>
  )
}
