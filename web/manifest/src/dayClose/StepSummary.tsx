import type { ReactNode } from 'react'
import type { Registration } from '../api'
import { difference, groupTandems, openCount } from './cashMath'
import { formatMoney, formatSigned, plural } from './format'

export interface StepSummaryProps {
  rows: Registration[]
  manager: string
  counted: { cash: number | null; card: number | null }
  expected: { cash: number; card: number }
  note: string
  /** The last run's failure, shown above the summary; null when there is none. */
  error: string | null
  onGoToTandems: () => void
}

function TillLine({ counted, expected }: { counted: number | null; expected: number }) {
  if (counted === null) {
    return <>nicht gezählt<span className="dc-sub numeral">erwartet {formatMoney(expected)}</span></>
  }
  const diff = difference(counted, expected) ?? 0
  return (
    <>
      <span className="numeral">{formatMoney(counted)}</span>
      <span className="dc-sub numeral">erwartet {formatMoney(expected)}</span>
      {diff === 0
        ? <span className="dc-ok">stimmt</span>
        : <span className="dc-off numeral">{formatSigned(diff)}</span>}
    </>
  )
}

export default function StepSummary({
  rows, manager, counted, expected, note, error, onGoToTandems,
}: StepSummaryProps) {
  const open = openCount(rows)
  const noMethod = groupTandems(rows).noMethod.length
  const lines: [string, ReactNode][] = [
    ['Betriebsleiter', manager.trim()],
    ['Tandems', (
      <>
        <span className="numeral">{rows.length}</span>
        <span className="dc-sub">{rows.length - open} kassiert · {open} offen</span>
      </>
    )],
    ['Bar', <TillLine key="cash" counted={counted.cash} expected={expected.cash} />],
    ['Karte', <TillLine key="card" counted={counted.card} expected={expected.card} />],
  ]
  if (note.trim() !== '') lines.push(['Begründung', note.trim()])

  const leftovers: string[] = []
  if (open > 0) {
    leftovers.push(`${open} ${plural(open, 'Tandem ist', 'Tandems sind')} noch nicht kassiert.`)
  }
  if (noMethod > 0) {
    leftovers.push(`${noMethod} ${plural(noMethod, 'Tandem hat', 'Tandems haben')} keine Zahlungsart.`)
  }

  return (
    <>
      <h3>Zusammenfassung</h3>
      <p className="dc-lede">So wird der Tag geschrieben. Ein Klick auf einen Schritt links ändert ihn noch.</p>
      {error && (
        <div className="dc-error" role="alert">
          <b>Tagesabschluss fehlgeschlagen</b>
          {error} Der Tag ist noch nicht abgeschlossen.
        </div>
      )}
      <dl className="dc-summary">
        {lines.map(([term, value], i) => (
          <div key={term} className="dc-summary-line">
            <dt id={`dc-sum-${i}`}>{term}</dt>
            <dd aria-labelledby={`dc-sum-${i}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {leftovers.length > 0 && (
        <ul className="dc-leftover">
          {leftovers.map((text) => (
            <li key={text}>
              <span>{text}</span>
              <button type="button" className="btn link" onClick={onGoToTandems}>Zu Tandems</button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
