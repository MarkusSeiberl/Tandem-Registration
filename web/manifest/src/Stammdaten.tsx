import { useCallback, useEffect, useState } from 'react'
import {
  addFlyer,
  addMaster,
  deleteFlyer,
  deleteMaster,
  flyers as fetchFlyers,
  masters as fetchMasters,
} from './api'
import type { StammdatenItem } from './api'
import Betraege from './Betraege'
import TrashIcon from './TrashIcon'

interface StammdatenListProps {
  title: string
  addLabel: string
  load: () => Promise<StammdatenItem[]>
  add: (name: string) => Promise<{ id: number }>
  remove: (id: number) => Promise<void>
}

function StammdatenList({ title, addLabel, load, add, remove }: StammdatenListProps) {
  const [items, setItems] = useState<StammdatenItem[]>([])
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    load().then(setItems).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler'))
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await add(trimmed)
      setName('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemove(item: StammdatenItem) {
    if (!window.confirm(`"${item.name}" entfernen?`)) return
    setBusy(true)
    setError(null)
    try {
      await remove(item.id)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="stammdaten-list">
      <h2>{title}</h2>
      {error && <p className="error">{error}</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            <span>{item.name}</span>
            <button
              type="button"
              className="btn secondary btn-icon"
              onClick={() => handleRemove(item)}
              disabled={busy}
              aria-label={`${item.name} entfernen`}
              title="Entfernen"
            >
              <TrashIcon />
            </button>
          </li>
        ))}
        {items.length === 0 && <li className="hint">Keine Einträge.</li>}
      </ul>
      <div className="add-row">
        <input
          type="text"
          value={name}
          placeholder={addLabel}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="button" className="btn primary" onClick={handleAdd} disabled={busy || !name.trim()}>
          Hinzufügen
        </button>
      </div>
    </section>
  )
}

export default function Stammdaten() {
  return (
    <div className="stammdaten-screen">
      <StammdatenList
        title="Tandemmaster"
        addLabel="Name des Tandemmasters"
        load={fetchMasters}
        add={addMaster}
        remove={deleteMaster}
      />
      <StammdatenList
        title="Kameraflieger"
        addLabel="Name des Kameraflieger"
        load={fetchFlyers}
        add={addFlyer}
        remove={deleteFlyer}
      />
      {/* The amounts sit under the crew they are paid to and charged for. */}
      <Betraege />
    </div>
  )
}
