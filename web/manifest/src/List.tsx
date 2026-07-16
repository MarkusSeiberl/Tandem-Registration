import { useCallback, useEffect, useState } from 'react'
import { exportDay, list, masters as fetchMasters } from './api'
import type { Registration } from './api'
import { useEvents } from './useEvents'
import { extraBookingLabel, paymentLabel } from './labels'
import { today } from './date'

export interface ListProps {
  onSelect: (registration: Registration) => void
}

export default function List({ onSelect }: ListProps) {
  const [date, setDate] = useState(today)
  const [rows, setRows] = useState<Registration[]>([])
  const [masterNames, setMasterNames] = useState<Map<number, string>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const refresh = useCallback(() => {
    setLoading(true)
    setError(null)
    list(date)
      .then(setRows)
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
      </div>

      {exportMessage && <p className="hint">{exportMessage}</p>}
      {error && <p className="error">{error}</p>}
      {loading && rows.length === 0 && <p>Lädt…</p>}

      <table className="manifest-table">
        <thead>
          <tr>
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
          {rows.map((row) => (
            <tr key={row.id} className="clickable-row" onClick={() => onSelect(row)}>
              <td>
                {row.first_name} {row.last_name}
              </td>
              <td>{row.age}</td>
              <td>{row.weight_kg}</td>
              <td>{row.tandem_master_id != null ? masterNames.get(row.tandem_master_id) ?? '' : ''}</td>
              <td>{row.load_number ?? ''}</td>
              <td>{extraBookingLabel(row.extra_booking)}</td>
              <td>{paymentLabel(row.payment_method)}</td>
            </tr>
          ))}
          {rows.length === 0 && !loading && (
            <tr>
              <td colSpan={7}>Keine Registrierungen für dieses Datum.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
