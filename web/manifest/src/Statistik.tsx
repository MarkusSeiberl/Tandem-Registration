import { useCallback, useEffect, useState } from 'react'
import { statistik, statistikMoney } from './api'
import type { JumpStats, MoneyStats } from './api'
import { formatEuro } from './pricing'
import { ColumnChart, KpiTile, RankList, ShareBar } from './statsCharts'
import { change, pointsChange, share } from './statsFormat'

// Austrian month names, as the club writes them.
const MONTHS = ['Jän', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const AGE_GROUPS = ['< 18', '18–25', '26–35', '36–50', '51–65', '> 65']

// Dates are calendar days, not instants: formatted in UTC so no time zone can
// shift them across midnight.
const asDay = (iso: string) => new Date(`${iso}T00:00:00Z`)
const shortDay = new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const longDay = new Intl.DateTimeFormat('de-AT', { day: 'numeric', month: 'long', timeZone: 'UTC' })
const weekdayDay = new Intl.DateTimeFormat('de-AT', {
  weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC',
})
const monthName = new Intl.DateTimeFormat('de-AT', { month: 'long', timeZone: 'UTC' })

const oneDecimal = (n: number) => n.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/**
 * The months a chart shows: every month with tandems in either year, and at
 * least April to October, so a normal season reads the same every year and a
 * winter jump is not cut off.
 */
function shownMonths(...series: (number[] | null | undefined)[]): number[] {
  const used = series.flatMap((s) => (s ?? []).flatMap((n, i) => (n > 0 ? [i] : [])))
  const from = Math.min(3, ...used)
  const to = Math.max(9, ...used)
  return Array.from({ length: to - from + 1 }, (_, i) => from + i)
}

function bestMonth(months: number[]): number {
  return months.reduce((best, n, i) => (n > months[best] ? i : best), 0)
}

function seasonLine(s: JumpStats): string {
  const parts = [`Saison ${shortDay.format(asDay(s.firstDay!))} – ${shortDay.format(asDay(s.lastDay!))}`]
  const best = bestMonth(s.months)
  parts.push(`bester Monat ${monthName.format(new Date(Date.UTC(s.year, best, 1)))} (${s.months[best]})`)
  if (s.busiestDay) parts.push(`stärkster Tag ${weekdayDay.format(asDay(s.busiestDay.date))} (${s.busiestDay.count})`)
  return parts.join(' · ')
}

function comparisonLine(s: JumpStats): string | null {
  if (!s.comparedTo) return null
  const { year, asOf } = s.comparedTo
  return asOf ? `Vergleich: ${year} bis ${longDay.format(asDay(`${year}-${asOf}`))}` : `Vergleich: ${year}`
}

// Says which bars are this year and which outlines last year.
function ChartKey({ year, before }: { year: number; before: number }) {
  return (
    <p className="chart-key">
      <span className="chart-key-bar" aria-hidden="true" /> {year}
      <span className="chart-key-ghost" aria-hidden="true" /> {before}
    </p>
  )
}

const days = (n: number) => `${n} ${n === 1 ? 'Tag' : 'Tage'}`

function Figures({ s }: { s: JumpStats }) {
  const p = s.previous
  const average = s.tandems / s.jumpDays
  const averageBefore = p && p.jumpDays > 0 ? p.tandems / p.jumpDays : null
  return (
    <section className="report-figures" aria-label="Kennzahlen">
      <KpiTile
        label="Tandems" value={String(s.tandems)}
        previous={p ? String(p.tandems) : undefined} delta={change(s.tandems, p?.tandems)}
      />
      <KpiTile
        label="Sprungtage" value={String(s.jumpDays)}
        previous={p ? String(p.jumpDays) : undefined} delta={change(s.jumpDays, p?.jumpDays)}
      />
      <KpiTile
        label="Ø pro Sprungtag" value={oneDecimal(average)}
        previous={averageBefore !== null ? oneDecimal(averageBefore) : undefined}
        delta={change(average, averageBefore)}
      />
      <KpiTile
        label="Mit Video" value={share(s.video, s.tandems)}
        previous={p ? share(p.video, p.tandems) : undefined}
        delta={pointsChange(s.video, s.tandems, p?.video ?? null, p?.tandems ?? null)}
      />
      <KpiTile
        label="Mit Gutschein" value={share(s.voucher, s.tandems)}
        previous={p ? share(p.voucher, p.tandems) : undefined}
        delta={pointsChange(s.voucher, s.tandems, p?.voucher ?? null, p?.tandems ?? null)}
      />
    </section>
  )
}

function Report({ s }: { s: JumpStats }) {
  const months = shownMonths(s.months, s.previous?.months)
  const compared = s.comparedTo !== null

  return (
    <>
      <Figures s={s} />

      <div className="report-grid report-grid-wide">
        <section className="panel report-section">
          <h2>Tandems pro Monat</h2>
          <ColumnChart
            ariaLabel="Tandems pro Monat"
            labels={months.map((m) => MONTHS[m])}
            values={months.map((m) => s.months[m])}
            previous={s.previous ? months.map((m) => s.previous!.months[m]) : null}
          />
          {s.comparedTo && <ChartKey year={s.year} before={s.comparedTo.year} />}
        </section>

        <section className="panel report-section">
          <h2>Gebuchte Leistung</h2>
          <ShareBar
            ariaLabel="Gebuchte Leistung"
            parts={[
              { label: 'nur Sprung', value: s.services.none },
              { label: 'Sprung+Video', value: s.services.video },
              { label: 'Sprung+Video+Foto', value: s.services.video_photo },
            ]}
          />
        </section>
      </div>

      <div className="report-grid report-grid-wide">
        <section className="panel report-section">
          <h2>Tandemmaster</h2>
          <RankList
            label="Tandemmaster"
            rows={s.masters.map((m) => ({
              name: m.name ?? 'ohne Tandemmaster',
              value: m.tandems,
              detail: `${days(m.days)} · bester Tag ${m.bestDay.count} · ${share(m.video, m.tandems)} mit Video`,
              delta: compared ? change(m.tandems, m.previous) : null,
            }))}
          />
        </section>

        <section className="panel report-section">
          <h2>Kameraflieger</h2>
          {s.flyers.length === 0
            ? <p className="report-note">Keine Video-Buchungen.</p>
            : (
              <RankList
                label="Kameraflieger"
                rows={s.flyers.map((f) => ({
                  name: f.name ?? 'ohne Kameraflieger',
                  value: f.jumps,
                  detail: `${days(f.days)} · davon ${f.videoPhoto} mit Foto`,
                }))}
              />
            )}
        </section>
      </div>

      <div className="report-grid report-grid-guests">
        <section className="panel report-section">
          <h2>Wochentage</h2>
          <ColumnChart
            ariaLabel="Tandems pro Wochentag"
            labels={WEEKDAYS}
            values={s.weekdays.map((w) => w.tandems)}
          />
        </section>

        <section className="panel report-section">
          <h2>Gäste</h2>
          <div className="guest-cols">
            <div>
              <h3>Alter</h3>
              <ColumnChart ariaLabel="Gäste nach Alter" labels={AGE_GROUPS} values={s.ageGroups} />
            </div>
            <div>
              <h3>Geschlecht</h3>
              <ShareBar
                ariaLabel="Gäste nach Geschlecht"
                parts={[
                  { label: 'weiblich', value: s.gender.female },
                  { label: 'männlich', value: s.gender.male },
                  { label: 'divers', value: s.gender.diverse },
                ]}
              />
            </div>
            <div>
              <h3>Woher</h3>
              <RankList label="Woher die Gäste kommen" rows={s.cities.map((c) => ({ name: c.city, value: c.count }))} />
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

function MoneyFigures({ m, months }: { m: MoneyStats; months: number[] }) {
  const p = m.previous
  return (
    <div className="money-figures">
      <section className="report-figures report-figures-money" aria-label="Umsatz-Kennzahlen">
        <KpiTile
          label="Leistungswert" value={formatEuro(m.value)}
          previous={p ? formatEuro(p.value) : undefined} delta={change(m.value, p?.value)}
        />
        <KpiTile
          label="Kassiert" value={formatEuro(m.collected)}
          previous={p ? formatEuro(p.collected) : undefined} delta={change(m.collected, p?.collected)}
        />
        <KpiTile
          label="Gutscheinwert" value={formatEuro(m.voucherValue)}
          previous={p ? formatEuro(p.voucherValue) : undefined} delta={change(m.voucherValue, p?.voucherValue)}
        />
        <KpiTile label="Ø pro Tandem" value={formatEuro(Math.round(m.perTandem * 100) / 100)} />
      </section>

      <div className="report-grid report-grid-wide">
        <section className="panel report-section">
          <h2>Leistungswert pro Monat</h2>
          <ColumnChart
            ariaLabel="Leistungswert pro Monat"
            labels={months.map((i) => MONTHS[i])}
            values={months.map((i) => m.months[i])}
            previous={p ? months.map((i) => p.months[i]) : null}
            format={(n) => formatEuro(Math.round(n))}
          />
          {m.comparedTo && <ChartKey year={m.year} before={m.comparedTo.year} />}
        </section>

        <section className="panel report-section">
          <h2>Kasse</h2>
          <ShareBar
            ariaLabel="Kasse"
            format={formatEuro}
            // A till nobody used is left out, not drawn as "0 €".
            parts={[
              { label: 'Bar', value: m.tills.cash },
              { label: 'Karte', value: m.tills.card },
              { label: 'nicht erfasst', value: m.tills.unrecorded },
            ].filter((part) => part.value !== 0)}
          />
        </section>
      </div>
    </div>
  )
}

/**
 * The confidential part of the report. The server answers it only on the
 * manifest PC; there it still stays closed until someone asks, and while closed
 * its figures are not in the page at all, so a printout never carries them by
 * accident.
 */
function Money({ m, months, open, onToggle }: {
  m: MoneyStats; months: number[]; open: boolean; onToggle: () => void
}) {
  return (
    <section className="report-money" aria-label="Umsatz">
      <div className="money-head">
        <div>
          <h2>Umsatz</h2>
          <p className="report-note">Nur an diesem PC sichtbar.</p>
        </div>
        <button type="button" className="btn secondary small money-toggle" aria-expanded={open} onClick={onToggle}>
          {open ? 'Umsatz ausblenden' : 'Umsatz anzeigen'}
        </button>
      </div>
      {open && <MoneyFigures m={m} months={months} />}
    </section>
  )
}

export default function Statistik() {
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [stats, setStats] = useState<JumpStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    let stale = false
    setError(null)
    statistik(year)
      .then((s) => { if (!stale) setStats(s) })
      .catch((e: Error) => { if (!stale) setError(e.message) })
    return () => { stale = true }
  }, [year])

  useEffect(() => load(), [load])

  // Asked for separately: on any other device the server refuses, and the page
  // then shows nothing about money at all.
  const [money, setMoney] = useState<MoneyStats | null>(null)
  const [moneyOpen, setMoneyOpen] = useState(false)
  useEffect(() => {
    let stale = false
    statistikMoney(year)
      .then((m) => { if (!stale) setMoney(m) })
      .catch(() => { if (!stale) setMoney(null) })
    return () => { stale = true }
  }, [year])

  const shown = stats?.year === year ? stats : null
  const years = stats?.years ?? []
  const earlier = years.filter((y) => y < year)
  const later = years.filter((y) => y > year)
  const hasTandems = shown !== null && shown.tandems > 0

  return (
    <div className="report" aria-busy={!shown && !error}>
      <header className="report-head">
        <h1>Jahresbericht {year}</h1>
        <div className="report-actions">
          <button
            type="button" className="btn secondary small calendar-nav" aria-label="Vorheriges Jahr"
            disabled={earlier.length === 0} onClick={() => setYear(Math.max(...earlier))}
          >
            ‹
          </button>
          <button
            type="button" className="btn secondary small calendar-nav" aria-label="Nächstes Jahr"
            disabled={later.length === 0} onClick={() => setYear(Math.min(...later))}
          >
            ›
          </button>
          {hasTandems && (
            <button type="button" className="btn secondary small" onClick={() => window.print()}>
              Drucken
            </button>
          )}
        </div>
        {hasTandems && (
          <div className="report-meta">
            <p>{seasonLine(shown)}</p>
            {comparisonLine(shown) && <p>{comparisonLine(shown)}</p>}
          </div>
        )}
      </header>

      {error && (
        <div className="calendar-error" role="alert">
          <p className="error">{error}</p>
          <button type="button" className="btn secondary small" onClick={() => load()}>
            Erneut versuchen
          </button>
        </div>
      )}

      {shown && !hasTandems && <p className="report-note">Keine Tandems in {year}.</p>}
      {hasTandems && <Report s={shown} />}
      {hasTandems && money?.year === year && (
        <Money
          m={money} months={shownMonths(shown.months, shown.previous?.months)}
          open={moneyOpen} onToggle={() => setMoneyOpen((o) => !o)}
        />
      )}
    </div>
  )
}
