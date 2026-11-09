import type { ReactNode } from 'react'
import type { ExportResult } from '../api'
import CheckIcon from '../CheckIcon'
import { formatLongDate, formatSigned, plural } from './format'

export interface ExportDoneProps {
  date: string
  result: ExportResult
  /** Counted minus expected per till; null where the till was not counted. */
  diffs: { cash: number | null; card: number | null }
  note: string
  openLeft: number
}

export default function ExportDone({ date, result, diffs, note, openLeft }: ExportDoneProps) {
  const voucherParts = [`${result.redemptionsWritten} eingetragen`]
  if (result.redemptionsPending > 0) voucherParts.push(`${result.redemptionsPending} noch offen`)
  if (result.redemptionsInvalid > 0) voucherParts.push(`${result.redemptionsInvalid} ungültig, nicht eingetragen`)

  const tills = (['cash', 'card'] as const).map((t) => ({ name: t === 'cash' ? 'Bar' : 'Karte', d: diffs[t] }))
  const counted = tills.filter((t) => t.d !== null)

  const lines: [string, ReactNode][] = [
    ['Gutscheinliste', <span key="v" className="dc-ok">{voucherParts.join(' · ')}</span>],
    ['Kassensturz', counted.length === 0 ? 'nicht gezählt' : (
      <span key="k">
        {counted.map((t) => (
          <span key={t.name} className="dc-till-result">
            {t.name}{' '}
            {t.d === 0
              ? <span className="dc-ok">stimmt</span>
              : <span className="dc-off numeral">{formatSigned(t.d!)}</span>}
          </span>
        ))}
        {note.trim() !== '' && <span className="dc-sub">{note.trim()}</span>}
      </span>
    )],
  ]
  if (openLeft > 0) {
    // Fragment, not a wrapping span: the dd's flex gap is what spaces the two.
    lines.push(['Offen geblieben', (
      <>
        <span>{openLeft} {plural(openLeft, 'Tandem', 'Tandems')}</span>{' '}
        <span className="dc-sub">wird beim nächsten Export nachgetragen, sobald kassiert</span>
      </>
    )])
  }

  return (
    <div className="dc-finish">
      <div className="dc-finish-head">
        <span className="dc-seal" aria-hidden="true"><CheckIcon size={26} /></span>
        <div>
          <h3>Tag abgeschlossen</h3>
          <p>{formatLongDate(date)} · {result.count} {plural(result.count, 'Tandem', 'Tandems')}</p>
        </div>
      </div>
      <div className="dc-path numeral">{result.path}</div>
      <dl className="dc-summary">
        {lines.map(([term, value], i) => (
          <div key={term} className="dc-summary-line">
            <dt id={`dc-done-${i}`}>{term}</dt>
            <dd aria-labelledby={`dc-done-${i}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
