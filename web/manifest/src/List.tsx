import { useCallback, useEffect, useState } from 'react'
import { exportDay, list, masters as fetchMasters, remove } from './api'
import type { Registration } from './api'
import { useEvents } from './useEvents'
import { extraBookingLabel, paymentLabel } from './labels'
import { today } from './date'
import TrashIcon from './TrashIcon'

export interface ListProps {
  onSelect: (registration: Registration) => void
}

// Which colored dot a payment method's pill gets — voucher (ember, matches the
// Gutschein-Nr. field it implies) and cash (go-green) are called out; card
// gets the neutral default dot.
function paymentPillClass(method: Registration['payment_method']): string {
  if (method === 'voucher') return 'pill pill-voucher'
  if (method === 'cash') return 'pill pill-go'
  return 'pill'
}

export default function List({ onSelect }: ListProps) {
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<Registration[]>([])
  const [masterNames, setMasterNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [deleting, setDeleting] = useState(false)

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

  // Highest load number first — that's who boards next; unassigned (null)
  // registrations sort last.
  const sortedRows = [...rows].sort((a, b) => (b.load_number ?? -1) - (a.load_number ?? -1))

  function toggleChecked(id: number) {
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleExport() {
    setExportMessage(null)
    setExporting(true)
    try {
      const result = await exportDay(date)
      setExportMessage(`Export erstellt: ${result.path} (${result.count} Einträge)`)
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
      <div className="list-toolbar">
        <label className="date-field">
          Datum
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
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
      </div>

      {exportMessage && <p className="hint">{exportMessage}</p>}
      {error && <p className="error">{error}</p>}
      {loading && rows.length === 0 && <p>Lädt…</p>}

      <table className="manifest-table">
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
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => (
            <tr key={row.id} className="clickable-row" onClick={() => onSelect(row)}>
              <td className="col-checkbox" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={checkedIds.has(row.id)}
                  onChange={() => toggleChecked(row.id)}
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
                {row.extra_booking && row.extra_booking !== 'none' && (
                  <span className="pill pill-video">{extraBookingLabel(row.extra_booking)}</span>
                )}
              </td>
              <td>
                {row.payment_method && (
                  <span className={paymentPillClass(row.payment_method)}>{paymentLabel(row.payment_method)}</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={8}>Keine Registrierungen für dieses Datum.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
