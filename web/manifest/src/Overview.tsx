import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { calendar } from './api'
import type { CalendarDay } from './api'
import { today } from './date'
import { useEvents } from './useEvents'

interface OverviewProps {
  /** Opens the manifest on the given day. */
  onOpenDay: (date: string) => void
}

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const monthTitle = new Intl.DateTimeFormat('de-AT', { month: 'long', year: 'numeric' })

// What a screen reader says for a day: the weekday is there because the column
// headings are only drawn, not tied to the buttons under them.
const dayName = new Intl.DateTimeFormat('de-AT', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
})

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** YYYY-MM of the month `offset` months away from `month`. */
function shiftMonth(month: string, offset: number): string {
  const [year, m] = month.split('-').map(Number)
  const d = new Date(year, m - 1 + offset, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** YYYY-MM-DD of the day `offset` days away from `date`. */
function shiftDate(date: string, offset: number): string {
  const [year, m, day] = date.split('-').map(Number)
  const d = new Date(year, m - 1, day + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The same day number in another month, held at that month's last day. */
function sameDayIn(month: string, date: string): string {
  const [year, m] = month.split('-').map(Number)
  const last = new Date(year, m, 0).getDate()
  return `${month}-${pad(Math.min(Number(date.slice(8)), last))}`
}

/** Monday 0 … Sunday 6. */
function weekdayIndex(date: string): number {
  const [year, m, day] = date.split('-').map(Number)
  return (new Date(year, m - 1, day).getDay() + 6) % 7
}

function asDate(date: string): Date {
  const [year, m, day] = date.split('-').map(Number)
  return new Date(year, m - 1, day)
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
 * The button above the calendar only opens the manifest on today — a day is
 * started by the first guest registering for it (see startDay in
 * src/server/dayTables.ts), never by anyone looking at it, so nothing is
 * written here.
 */
export default function Overview({ onOpenDay }: OverviewProps) {
  const currentMonth = today().slice(0, 7)
  const todayIso = today()
  const [month, setMonth] = useState(currentMonth)
  const [days, setDays] = useState<Map<string, CalendarDay>>(new Map())
  // The month `days` belongs to. Until the month on screen has arrived, its
  // cells are drawn as loading rather than as days nobody jumped.
  const [loadedMonth, setLoadedMonth] = useState<string | null>(null)
  const [error, setError] = useState(false)
  // Today's entry, kept apart so the button can name it while another month
  // is on screen.
  const [todayEntry, setTodayEntry] = useState<CalendarDay | null>(null)

  // The one day button the Tab key lands on; the arrow keys move it.
  const [focusDate, setFocusDate] = useState(todayIso)
  const dayRefs = useRef(new Map<string, HTMLButtonElement>())
  // Set when a key moved the focus, so the button is focused once it exists —
  // in another month it is only drawn after the month has changed.
  const pendingFocus = useRef(false)

  const refresh = useCallback(() => {
    let stale = false
    calendar(month)
      .then((list) => {
        if (stale) return
        setDays(new Map(list.map((d) => [d.date, d])))
        setLoadedMonth(month)
        setError(false)
        if (month === currentMonth) setTodayEntry(list.find((d) => d.date === todayIso) ?? null)
      })
      .catch(() => {
        // Never the raw message: a server that is gone answers with the
        // browser's English "Failed to fetch".
        if (!stale) setError(true)
      })
    if (month !== currentMonth) {
      calendar(currentMonth)
        .then((list) => {
          if (!stale) setTodayEntry(list.find((d) => d.date === todayIso) ?? null)
        })
        .catch(() => {})
    }
    return () => { stale = true }
  }, [month, currentMonth, todayIso])

  useEffect(() => refresh(), [refresh])

  // A guest registering or paying while the overview is open belongs on the
  // counts at once.
  useEvents(() => { refresh() })

  useEffect(() => {
    if (!pendingFocus.current) return
    const button = dayRefs.current.get(focusDate)
    if (!button) return
    pendingFocus.current = false
    button.focus()
  }, [focusDate, month])

  function showMonth(next: string) {
    setMonth(next)
    setFocusDate(next === currentMonth ? todayIso : `${next}-01`)
  }

  function moveFocus(next: string) {
    pendingFocus.current = true
    setFocusDate(next)
    if (next.slice(0, 7) !== month) setMonth(next.slice(0, 7))
  }

  // The calendar is one stop for Tab; inside it the keys of every date picker.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, date: string) {
    const weekday = weekdayIndex(date)
    const moves: Record<string, () => string> = {
      ArrowLeft: () => shiftDate(date, -1),
      ArrowRight: () => shiftDate(date, 1),
      ArrowUp: () => shiftDate(date, -7),
      ArrowDown: () => shiftDate(date, 7),
      Home: () => shiftDate(date, -weekday),
      End: () => shiftDate(date, 6 - weekday),
      PageUp: () => sameDayIn(shiftMonth(month, -1), date),
      PageDown: () => sameDayIn(shiftMonth(month, 1), date),
    }
    const move = moves[e.key]
    if (!move) return
    e.preventDefault()
    moveFocus(move())
  }

  const [year, m] = month.split('-').map(Number)
  const loaded = loadedMonth === month
  // The focus stop has to be a day of the month on screen.
  const tabStop = focusDate.slice(0, 7) === month ? focusDate : `${month}-01`

  return (
    <div className="overview">
      <h1>Übersicht</h1>

      {/* Names the day it opens, and how far it has got: "new" would be
          wrong once the first guest has registered. */}
      <button type="button" className="btn primary overview-new-day" onClick={() => onOpenDay(todayIso)}>
        {todayEntry && todayEntry.count > 0
          ? `Heute öffnen (${tandemLabel(todayEntry.count)})`
          : 'Heute öffnen'}
      </button>

      <section className="calendar" aria-label="Kalender">
        <div className="calendar-head">
          <button
            type="button"
            className="btn secondary small calendar-nav"
            onClick={() => showMonth(shiftMonth(month, -1))}
            aria-label="Vorheriger Monat"
          >
            ‹
          </button>
          {/* Announced when it changes: the arrows and PageUp/PageDown move
              to another month without the focus leaving the grid. */}
          <h2 className="calendar-title" aria-live="polite">
            {monthTitle.format(new Date(year, m - 1, 1))}
          </h2>
          <button
            type="button"
            className="btn secondary small calendar-nav"
            onClick={() => showMonth(shiftMonth(month, 1))}
            aria-label="Nächster Monat"
          >
            ›
          </button>
          <button
            type="button"
            className="btn secondary small calendar-today-button"
            onClick={() => showMonth(currentMonth)}
            disabled={month === currentMonth}
          >
            Heute
          </button>
        </div>

        {error && (
          <div className="calendar-error" role="alert">
            <p className="error">Kalender konnte nicht geladen werden.</p>
            <button type="button" className="btn secondary small" onClick={() => refresh()}>
              Erneut versuchen
            </button>
          </div>
        )}

        <div className={loaded ? 'calendar-grid' : 'calendar-grid loading'} aria-busy={!loaded}>
          {WEEKDAYS.map((wd) => (
            <div key={wd} className="calendar-weekday" aria-hidden="true">{wd}</div>
          ))}
          {monthCells(month).map((date, i) => {
            if (!date) return <div key={`pad-${i}`} className="calendar-pad" />
            const entry = loaded ? days.get(date) : undefined
            const count = entry?.count ?? 0
            const open = entry?.open ?? 0
            const isToday = date === todayIso
            // Today is not overdue: its Tagesabschluss comes at the end of it.
            const running = isToday && count > 0 && !entry?.exported
            const unclosed = !isToday && count > 0 && !entry?.exported
            const classes = ['calendar-day']
            if (count > 0) classes.push('jumped')
            if (isToday) classes.push('today')
            const label = [
              dayName.format(asDate(date)),
              count > 0 && tandemLabel(count),
              open > 0 && `${open} offen`,
              running && 'Tag läuft',
              unclosed && 'Abschluss fehlt',
            ].filter(Boolean).join(', ')
            return (
              <button
                key={date}
                ref={(el) => {
                  if (el) dayRefs.current.set(date, el)
                  else dayRefs.current.delete(date)
                }}
                type="button"
                className={classes.join(' ')}
                tabIndex={date === tabStop ? 0 : -1}
                onClick={() => onOpenDay(date)}
                onKeyDown={(e) => handleKeyDown(e, date)}
                onFocus={() => setFocusDate(date)}
                aria-current={isToday ? 'date' : undefined}
                aria-label={label}
              >
                <span className="calendar-day-head">
                  <span className="calendar-day-number">{Number(date.slice(8))}</span>
                  {isToday && <span className="calendar-today-label">Heute</span>}
                </span>
                {count > 0 && <span className="calendar-count">{tandemLabel(count)}</span>}
                {/* Money first: a day can be closed and still owed. */}
                {open > 0 && <span className="calendar-open">{open} offen</span>}
                {running && <span className="calendar-running">Tag läuft</span>}
                {unclosed && (
                  <span className="calendar-unclosed" title="Tagesabschluss fehlt">
                    Abschluss fehlt
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
