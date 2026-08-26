import { useCallback, useEffect, useState } from 'react'
import {
  dayTables, exportDay, list, masters as fetchMasters, patch, pendingRedemptions,
  remove, repriceDay,
} from './api'
import type { DayTables, Registration } from './api'
import { useEvents } from './useEvents'
import { extraBookingLabel, paymentLabel, weightSurchargeLabel } from './labels'
import { formatEuro } from './pricing'
import { today } from './date'
import TrashIcon from './TrashIcon'

export interface ListProps {
  onSelect: (registration: Registration) => void
  /** The day being shown. Owned by App so it survives leaving this screen. */
  date: string
  onDateChange: (date: string) => void
}

// Which colored dot a payment method's pill gets — voucher (ember, matches the
// Gutschein-Nr. field it implies) and cash (go-green) are called out; card
// gets the neutral default dot.
function paymentPillClass(method: Registration['payment_method']): string {
  if (method === 'voucher') return 'pill pill-voucher'
  if (method === 'cash') return 'pill pill-go'
  return 'pill'
}

const COLUMN_COUNT = 10

interface TableProps {
  caption: string
  rows: Registration[]
  emptyText: string
  masterNames: Map<number, string>
  checkedIds: Set<number>
  onToggleChecked: (id: number) => void
  onSelect: (registration: Registration) => void
  onSetPaid: (registration: Registration, paid: boolean) => void
  pendingId: number | null
  /** 'open' still owes money, 'paid' has been collected. */
  variant: 'open' | 'paid'
}

function RegistrationTable({
  caption, rows, emptyText, masterNames, checkedIds, onToggleChecked, onSelect, onSetPaid,
  pendingId, variant,
}: TableProps) {
  return (
    <table className={`manifest-table manifest-table-${variant}`}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th className="col-checkbox"></th>
          <th>Name</th>
          <th>Alter</th>
          <th>Gewicht (kg)</th>
          <th>Tandemmaster</th>
          <th>Load-Nr.</th>
          <th>Zusatzbuchung</th>
          <th>Zahlungsart</th>
          <th>Preis</th>
          <th className="col-action"></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id} className="clickable-row" onClick={() => onSelect(row)}>
            <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={checkedIds.has(row.id)}
                onChange={() => onToggleChecked(row.id)}
                aria-label={`${row.first_name} ${row.last_name} auswählen`}
              />
            </td>
            <td>
              {row.first_name} {row.last_name}
            </td>
            <td className="numeral">{row.age}</td>
            <td className="numeral">{row.weight_kg}</td>
            <td>{row.tandem_master_id != null ? masterNames.get(row.tandem_master_id) ?? '' : ''}</td>
            <td className="numeral">{row.load_number ?? ''}</td>
            <td>
              {/*
                Only the service actually flown — it already includes whatever
                the voucher covers, so showing the voucher service too would
                print "Sprung+Video" beside "Sprung+Video+Foto" for one jump.
                Which part was prepaid is a detail-screen question.
              */}
              {row.extra_booking && row.extra_booking !== 'none' && (
                <span className="pill pill-video">{extraBookingLabel(row.extra_booking)}</span>
              )}
              {row.weight_surcharge && row.weight_surcharge !== 'none' && (
                <span className="pill pill-surcharge">{weightSurchargeLabel(row.weight_surcharge)}</span>
              )}
            </td>
            <td>
              {row.payment_method && (
                <span className={paymentPillClass(row.payment_method)}>{paymentLabel(row.payment_method)}</span>
              )}
              {/*
                A voucher moves no money, so for counting the till at closing
                what matters is how the top-up was paid.
              */}
              {row.payment_method === 'voucher' && row.voucher_payment_method && (
                <span className={paymentPillClass(row.voucher_payment_method)}>
                  {paymentLabel(row.voucher_payment_method)}
                </span>
              )}
            </td>
            <td className="numeral">{row.price != null ? formatEuro(row.price) : ''}</td>
            {/*
              The row click opens the detail screen, so the action has to keep
              its click to itself.
            */}
            <td className="col-action" onClick={(e) => e.stopPropagation()}>
              {variant === 'open' ? (
                <button
                  type="button"
                  className="btn small collect"
                  onClick={() => onSetPaid(row, true)}
                  disabled={pendingId === row.id}
                >
                  ✓ Kassiert
                </button>
              ) : (
                <button
                  type="button"
                  className="btn small ghost"
                  onClick={() => onSetPaid(row, false)}
                  disabled={pendingId === row.id}
                  aria-label="Als offen markieren"
                  title="Als offen markieren"
                >
                  ↩
                </button>
              )}
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={COLUMN_COUNT}>{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export default function List({ onSelect, date, onDateChange }: ListProps) {
  const [rows, setRows] = useState<Registration[]>([])
  const [masterNames, setMasterNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [pending, setPending] = useState(0)
  // What this day runs on. The list is the screen that shows a day, so the day's
  // prices — and the one action that changes them — belong here.
  const [day, setDay] = useState<DayTables | null>(null)
  const [repricing, setRepricing] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    list(date)
      .then((items) => {
        setRows(items)
        // Rows change identity across a refresh (deletes, a new registration) —
        // any stale checked ids from before would silently keep the delete
        // button enabled for rows that no longer exist.
        setCheckedIds(new Set())
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [date])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Cleared when the day changes so the banner cannot describe the day before;
  // refetched after every refresh so it reflects a reprice straight away.
  useEffect(() => {
    setDay(null)
  }, [date])

  useEffect(() => {
    dayTables(date).then(setDay).catch(() => {})
  }, [date, rows])

  useEffect(() => {
    fetchMasters()
      .then((items) => setMasterNames(new Map(items.map((m) => [m.id, m.name]))))
      .catch(() => {
        // Tandemmaster-Namen sind nur eine Anzeige-Ergänzung; ein Fehler hier
        // soll die Liste selbst nicht blockieren.
      })
  }, [])

  // Live refresh: re-fetch the current date whenever the server reports a change
  // (new guest registration, or an edit saved from another manifest client).
  useEvents(refresh)

  // Refreshed with the list, so a redemption written by the export disappears
  // from the banner without a reload.
  useEffect(() => {
    pendingRedemptions().then((r) => setPending(r.count)).catch(() => {})
  }, [rows])

  // Highest load number first — that's who boards next; unassigned (null)
  // registrations sort last.
  // The club edited a price after this day had started. Nothing is wrong — the
  // day is simply older than the price list — but it is worth saying so, because
  // otherwise the numbers here and the numbers in the settings disagree without
  // explanation.
  const dayOutdated =
    day !== null && day.frozen &&
    JSON.stringify(day.prices) !== JSON.stringify(day.current.prices)
  // Only the running day can still be moved. A day that is over has been flown,
  // collected and usually exported; those amounts are what guests paid, and a
  // price list edited afterwards does not get to rewrite them. So a past day
  // gets the explanation without the button.
  const isToday = date === today()

  async function handleReprice() {
    setRepricing(true)
    setError(null)
    try {
      await repriceDay(date)
      refresh()
      setDay(await dayTables(date))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preise übernehmen fehlgeschlagen')
    } finally {
      setRepricing(false)
    }
  }

  const sortedRows = [...rows].sort((a, b) => (b.load_number ?? -1) - (a.load_number ?? -1))
  // Payment happens after the jump, so the open table is the working list and
  // the collected one is the archive of the day.
  const openRows = sortedRows.filter((r) => r.paid_at == null)
  const paidRows = sortedRows.filter((r) => r.paid_at != null)
  const sumOf = (items: Registration[]) => items.reduce((sum, r) => sum + (r.price ?? 0), 0)

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleSetPaid(row: Registration, paid: boolean) {
    setPendingId(row.id)
    setError(null)
    try {
      const updated = await patch(row.id, { paid })
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setPendingId(null)
    }
  }

  async function handleExport() {
    setExportMessage(null)
    setExporting(true)
    try {
      const result = await exportDay(date)
      const parts = [`Export erstellt: ${result.path} (${result.count} Einträge)`]
      if (result.redemptionsWritten > 0) {
        // Same count, same wording as the banner two lines below — one of them
        // saying "1 Einlösungen" while the other says "1 Einlösung" reads as two
        // different numbers.
        parts.push(result.redemptionsWritten === 1
          ? '1 Einlösung eingetragen'
          : `${result.redemptionsWritten} Einlösungen eingetragen`)
      }
      if (result.redemptionsPending > 0) {
        parts.push(`${result.redemptionsPending} noch offen`)
      }
      if (result.redemptionsInvalid > 0) {
        parts.push(`${result.redemptionsInvalid} ungültig, nicht eingetragen`)
      }
      setExportMessage(parts.join(' · '))
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'Export fehlgeschlagen')
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    if (checkedIds.size === 0) return
    const confirmed = window.confirm(
      checkedIds.size === 1
        ? '1 Registrierung löschen?'
        : `${checkedIds.size} Registrierungen löschen?`
    )
    if (!confirmed) return
    setDeleting(true)
    setError(null)
    try {
      for (const id of checkedIds) {
        await remove(id)
      }
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="list-screen">
      {pending > 0 && (
        <p className="hint warn">
          {pending === 1
            ? '1 Einlösung noch nicht in die Gutscheinliste geschrieben.'
            : `${pending} Einlösungen noch nicht in die Gutscheinliste geschrieben.`}
        </p>
      )}
      {dayOutdated && (isToday ? (
        <div className="day-outdated">
          <p>
            Dieser Tag läuft auf der Preisliste von seinem Beginn
            ({formatEuro(day!.prices.jump)} pro Sprung, aktuell{' '}
            {formatEuro(day!.current.prices.jump)}). Die Beträge bleiben so, bis jemand es
            ausdrücklich ändert.
          </p>
          <button
            type="button"
            className="btn secondary small"
            onClick={handleReprice}
            disabled={repricing}
          >
            {repricing ? 'Wird übernommen…' : 'Preise für diesen Tag aktualisieren'}
          </button>
        </div>
      ) : (
        <div className="day-outdated day-settled">
          <p>
            Dieser Tag wurde mit der Preisliste von seinem Beginn abgerechnet
            ({formatEuro(day!.prices.jump)} pro Sprung, aktuell{' '}
            {formatEuro(day!.current.prices.jump)}). Abgeschlossene Tage bleiben, wie sie
            geflogen wurden.
          </p>
        </div>
      ))}

      <div className="list-toolbar">
        <label className="date-field">
          Datum
          <input
            type="date"
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
          />
        </label>
        {/* One press back to the running day, from wherever the operator
            wandered off to. Off while it would change nothing. */}
        <button
          type="button"
          className="btn secondary small"
          onClick={() => onDateChange(today())}
          disabled={date === today()}
        >
          Heute
        </button>
        <button type="button" className="btn secondary" onClick={handleExport} disabled={exporting}>
          {exporting ? 'Exportiere…' : 'Exportieren'}
        </button>
        <button
          type="button"
          className="btn secondary btn-icon"
          onClick={handleDelete}
          disabled={checkedIds.size === 0 || deleting}
          aria-label="Ausgewählte löschen"
          title="Ausgewählte löschen"
        >
          <TrashIcon />
        </button>
        <span className="list-count">
          {rows.length} {rows.length === 1 ? 'Eintrag' : 'Einträge'}
        </span>
        {/* What is still to be collected, and what already went into the till. */}
        <span className="list-total list-total-open">Offen: {formatEuro(sumOf(openRows))}</span>
        <span className="list-total">Kassiert: {formatEuro(sumOf(paidRows))}</span>
      </div>

      {exportMessage && <p className="hint">{exportMessage}</p>}
      {error && <p className="error">{error}</p>}
      {loading && rows.length === 0 && <p>Lädt…</p>}

      {rows.length === 0 && !loading ? (
        // Two empty tables for an empty day would be noise — one line says it.
        <p>Keine Registrierungen für dieses Datum.</p>
      ) : (
        <>
          <RegistrationTable
            caption={`Offen (${openRows.length})`}
            rows={openRows}
            emptyText="Keine offenen Einträge."
            masterNames={masterNames}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSelect={onSelect}
            onSetPaid={handleSetPaid}
            pendingId={pendingId}
            variant="open"
          />
          <RegistrationTable
            caption={`Kassiert (${paidRows.length})`}
            rows={paidRows}
            emptyText="Noch nichts kassiert."
            masterNames={masterNames}
            checkedIds={checkedIds}
            onToggleChecked={toggleChecked}
            onSelect={onSelect}
            onSetPaid={handleSetPaid}
            pendingId={pendingId}
            variant="paid"
          />
        </>
      )}
    </div>
  )
}
