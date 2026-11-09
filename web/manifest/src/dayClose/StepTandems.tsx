import { useEffect, useRef, useState } from 'react'
import type { CollectedVia, Registration } from '../api'
import CheckIcon from '../CheckIcon'
import { groupTandems } from './cashMath'
import { formatMoney } from './format'

export interface StepTandemsProps {
  rows: Registration[]
  masterNames: Map<number, string>
  /** Collects the row (or names its till); throws with a message on failure. */
  settleRow: (row: Registration, method: CollectedVia | null) => Promise<void>
  disabled: boolean
}

// Long enough for the slide-out in index.css (.dc-row.leaving).
const LEAVE_MS = 320

const fullName = (r: Registration) => `${r.first_name} ${r.last_name}`

// Highest load first, the way the manifest list reads.
const byLoad = (a: Registration, b: Registration) =>
  (b.load_number ?? -1) - (a.load_number ?? -1) || a.id - b.id

export default function StepTandems({ rows, masterNames, settleRow, disabled }: StepTandemsProps) {
  const groups = groupTandems(rows)
  const [busy, setBusy] = useState<Set<number>>(new Set())
  const [errors, setErrors] = useState<Map<number, string>>(new Map())
  // A settled row has already left its group in `rows`; it is drawn once more
  // from this snapshot while it slides out, so the list does not jump.
  const [leaving, setLeaving] = useState<Map<number, { group: keyof typeof groups; row: Registration }>>(new Map())
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  async function settle(group: keyof typeof groups, row: Registration, method: CollectedVia | null) {
    setBusy((prev) => new Set(prev).add(row.id))
    setErrors((prev) => { const next = new Map(prev); next.delete(row.id); return next })
    try {
      await settleRow(row, method)
      setLeaving((prev) => new Map(prev).set(row.id, { group, row }))
      timers.current.push(window.setTimeout(() => {
        setLeaving((prev) => { const next = new Map(prev); next.delete(row.id); return next })
      }, LEAVE_MS))
    } catch (err) {
      setErrors((prev) => new Map(prev).set(row.id, err instanceof Error ? err.message : 'Kassieren fehlgeschlagen'))
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(row.id); return next })
    }
  }

  const shown = (group: keyof typeof groups) => {
    const live = groups[group]
    const ghosts = [...leaving.values()]
      .filter((l) => l.group === group && !live.some((r) => r.id === l.row.id))
      .map((l) => l.row)
    return [...live, ...ghosts].sort(byLoad)
  }

  const sections: { key: keyof typeof groups; title: string; covered: boolean }[] = [
    { key: 'open', title: 'Noch nicht kassiert', covered: false },
    { key: 'noMethod', title: 'Kassiert, ohne Zahlungsart', covered: false },
    { key: 'freeVoucher', title: 'Gutschein, nichts zu zahlen', covered: true },
  ]
  const visible = sections.filter((s) => shown(s.key).length > 0)

  return (
    <>
      <h3>Offene Tandems</h3>
      <p className="dc-lede">
        Was noch nicht kassiert ist oder keine Zahlungsart hat. Ein Druck auf Bar oder Karte kassiert sofort.
      </p>
      {visible.length === 0 && (
        <div className="dc-allclear">
          <b><CheckIcon size={18} /> Alles erledigt</b>
          <span>
            {rows.length === 1
              ? 'Das Tandem des Tages ist kassiert und hat eine Zahlungsart.'
              : `Alle ${rows.length} Tandems sind kassiert und haben eine Zahlungsart.`}
          </span>
        </div>
      )}
      {visible.map(({ key, title, covered }) => {
        const list = shown(key)
        const live = groups[key]
        const sum = live.reduce((s, r) => s + (r.price ?? 0), 0)
        return (
          <section className="dc-group" key={key}>
            <div className="dc-group-head">
              <h4 id={`dc-group-${key}`}>{title}</h4>
              <span className="dc-count">{live.length}</span>
              {!covered && <span className="dc-sum numeral">{formatMoney(sum)}</span>}
            </div>
            <ul className="dc-rows" aria-labelledby={`dc-group-${key}`}>
              {list.map((r) => {
                const isLeaving = !live.some((x) => x.id === r.id)
                const name = fullName(r)
                const master = r.tandem_master_id != null ? masterNames.get(r.tandem_master_id) : undefined
                const sub = [
                  r.load_number != null ? `Load ${r.load_number}` : null,
                  master ? `TM ${master}` : null,
                ].filter(Boolean).join(' · ')
                const lock = disabled || isLeaving || busy.has(r.id)
                return (
                  <li key={r.id} className={isLeaving ? 'dc-row leaving' : 'dc-row'}>
                    <span className="dc-name">
                      {name}
                      {sub && <small>{sub}</small>}
                      {errors.has(r.id) && <small className="dc-row-error" role="alert">{errors.get(r.id)}</small>}
                    </span>
                    <span>{r.payment_method === 'voucher' && <span className="pill pill-voucher">Gutschein</span>}</span>
                    <span className="dc-price numeral">{formatMoney(r.price ?? 0)}</span>
                    <span className="dc-acts">
                      {covered ? (
                        <button type="button" className="btn secondary small" disabled={lock}
                          aria-label={`${name}: Kassieren`} onClick={() => void settle(key, r, null)}>
                          Kassieren
                        </button>
                      ) : (
                        <>
                          <button type="button" className="btn secondary small" disabled={lock}
                            aria-label={`${name}: Bar`} onClick={() => void settle(key, r, 'cash')}>
                            Bar
                          </button>
                          <button type="button" className="btn secondary small" disabled={lock}
                            aria-label={`${name}: Karte`} onClick={() => void settle(key, r, 'card')}>
                            Karte
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </>
  )
}
