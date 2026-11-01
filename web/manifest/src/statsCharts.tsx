// The building blocks of the yearly report on the Statistik page. Plain HTML
// bars rather than a chart library: the exe ships without extra dependencies,
// and HTML prints as crisply as it draws.

import type { CSSProperties } from 'react'
import { share } from './statsFormat'

// A change reads as better or worse by its words; the colour only repeats it.
function deltaClass(delta: string): string {
  if (delta.startsWith('+')) return 'delta up'
  if (delta.startsWith('−')) return 'delta down'
  return 'delta'
}

export function Delta({ value }: { value: string | null | undefined }) {
  if (!value) return null
  return <span className={deltaClass(value)}>{value}</span>
}

interface KpiTileProps {
  label: string
  value: string
  /** Last year's figure, already formatted. */
  previous?: string
  delta?: string | null
}

export function KpiTile({ label, value, previous, delta }: KpiTileProps) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {previous !== undefined && (
        <span className="kpi-compare">
          <span className="kpi-previous">{previous} im Vorjahr</span>
          <Delta value={delta} />
        </span>
      )}
    </div>
  )
}

interface ColumnChartProps {
  labels: string[]
  values: number[]
  /** Last year's values, drawn as outlines behind this year's bars. */
  previous?: number[] | null
  format?: (n: number) => string
  ariaLabel: string
}

export function ColumnChart({ labels, values, previous, format = String, ariaLabel }: ColumnChartProps) {
  const max = Math.max(1, ...values, ...(previous ?? []))
  // A small value still shows as a sliver; zero shows as nothing at all.
  const height = (n: number): CSSProperties => ({ height: n > 0 ? `max(2px, ${(n / max) * 100}%)` : 0 })
  const summary = labels
    .map((label, i) => `${label} ${format(values[i])}${previous ? ` (Vorjahr ${format(previous[i])})` : ''}`)
    .join(', ')

  return (
    <div className="column-chart" role="img" aria-label={`${ariaLabel}: ${summary}`}>
      {labels.map((label, i) => (
        <div
          key={label}
          className="column"
          title={`${label}: ${format(values[i])}${previous ? ` · Vorjahr ${format(previous[i])}` : ''}`}
        >
          {/* The plot leaves room above the tallest bar for its value. */}
          <div className="column-plot">
            <div className="column-area">
              {previous && previous[i] > 0 && <div className="chart-ghost" style={height(previous[i])} />}
              <div className="column-bar" style={height(values[i])}>
                {values[i] > 0 && <span className="column-value">{format(values[i])}</span>}
              </div>
            </div>
          </div>
          <span className="column-label">{label}</span>
        </div>
      ))}
    </div>
  )
}

interface ShareBarProps {
  parts: { label: string; value: number }[]
  format?: (n: number) => string
  ariaLabel: string
}

export function ShareBar({ parts, format = String, ariaLabel }: ShareBarProps) {
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  return (
    <div className="share">
      <div
        className="share-bar"
        role="img"
        aria-label={`${ariaLabel}: ${parts.map((p) => `${p.label} ${share(p.value, total)}`).join(', ')}`}
      >
        {parts.map((p, i) => p.value > 0 && (
          <div
            key={p.label}
            className={`share-segment share-${i + 1}`}
            style={{ flexGrow: p.value }}
            title={`${p.label}: ${format(p.value)} (${share(p.value, total)})`}
          />
        ))}
      </div>
      <ul className="share-legend">
        {parts.map((p, i) => (
          <li key={p.label}>
            <span className={`share-swatch share-${i + 1}`} aria-hidden="true" />
            <span className="share-legend-label">{p.label}</span>
            <span className="share-legend-value">{format(p.value)}</span>
            <span className="share-legend-share">{share(p.value, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface RankListProps {
  label: string
  rows: { name: string; value: number; detail?: string; delta?: string | null }[]
}

export function RankList({ label, rows }: RankListProps) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ol className="rank-list" aria-label={label}>
      {rows.map((r) => (
        <li key={r.name} className="rank-row">
          <span className="rank-name">{r.name}</span>
          <span className="rank-value">
            {r.value}
            <Delta value={r.delta} />
          </span>
          <span className="rank-track" aria-hidden="true">
            <span className="rank-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          {r.detail && <span className="rank-detail">{r.detail}</span>}
        </li>
      ))}
    </ol>
  )
}
