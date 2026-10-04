import { useCallback, useEffect, useState } from 'react'
import { calendar } from './api'
import { today } from './date'
import { useEvents } from './useEvents'

interface OverviewProps {
  /** Opens the manifest on the given day. */
  onOpenDay: (date: string) => void
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const monthTitle = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric' })

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM of the month `offset` months away from `month`. */
function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(year, m - 1 + offset, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/**
 * The cells of one month, Monday first as on an Austrian calendar. `null` pads
 * the first week up to the 1st and the last week out to Sunday.
 */
function monthCells(month: string): (string | null)[] {
  const [year, m] = month.split('-').map(Number)
  const daysInMonth = new Date(year, m, 0).getDate()
  // getDay() counts from Sunday; shift so Monday is 0.
  const lead = (new Date(year, m - 1, 1).getDay() + 6) % 7
  const cells: (string | null)[] = Array(lead).fill(null)
  for (let day = 1; day <= daysInMonth; day++) cells.push(`${month}-${pad(day)}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function tandemLabel(count: number): string {
  return count === 1 ? '1 Tandem' : `${count} Tandems`
}

/**
 * The start screen: where a jump day begins, and a look back at the days
 * already flown.
 *
 * "Neuer Tandemtag" only opens the manifest on today — a day is started by the
 * first guest registering for it (see startDay in src/server/dayTables.ts),
 * never by anyone looking at it, so nothing is written here.
 */
export default function Overview({ onOpenDay }: OverviewProps) {
  const currentMonth = today().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    let stale = false
    calendar(month)
      .then((days) => {
        if (stale) return
        setCounts(new Map(days.map((d) => [d.date, d.count])))
        setError(null)
      })
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof Error ? err.message : 'Kalender konnte nicht geladen werden')
      })
    return () => { stale = true }
  }, [month])

  useEffect(() => refresh(), [refresh])

  // A guest registering while the overview is open belongs on today's count.
  useEvents(() => { refresh() })

  const [year, m] = month.split('-').map(Number)
  const todayIso = today()

  return (
    <div className="overview">
      <h1>Übersicht</h1>

      <button type="button" className="btn primary overview-new-day" onClick={() => onOpenDay(todayIso)}>
        Neuer Tandemtag
      </button>

      <section className="calendar" aria-label="Kalender">
        <div className="calendar-head">
          <button
            type="button"
            className="btn secondary small calendar-nav"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label="Vorheriger Monat"
          >
            ‹
          </button>
          <h2 className="calendar-title">{monthTitle.format(new Date(year, m - 1, 1))}</h2>
          <button
            type="button"
            className="btn secondary small calendar-nav"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label="Nächster Monat"
          >
            ›
          </button>
          <button
            type="button"
            className="btn secondary small"
            onClick={() => setMonth(currentMonth)}
            disabled={month === currentMonth}
          >
            Heute
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        <div className="calendar-grid">
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="calendar-weekday">{wd}</div>
          ))}
          {monthCells(month).map((date, i) => {
            if (!date) return <div key={`pad-${i}`} className="calendar-pad" />
            const count = counts.get(date) ?? 0
            const classes = ['calendar-day']
            if (count > 0) classes.push('jumped')
            if (date === todayIso) classes.push('today')
            return (
              <button
                key={date}
                type="button"
                className={classes.join(' ')}
                onClick={() => onOpenDay(date)}
                aria-current={date === todayIso ? 'date' : undefined}
                aria-label={`${Number(date.slice(8))}.${m}.${year}${count > 0 ? `, ${tandemLabel(count)}` : ''}`}
              >
                <span className="calendar-day-number">{Number(date.slice(8))}</span>
                {count > 0 && <span className="calendar-count">{tandemLabel(count)}</span>}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
