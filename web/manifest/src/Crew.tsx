import { useCallback, useEffect, useState } from 'react'
import type { KeyboardEvent } from 'react'
import {
  addFlyer,
  addMaster,
  deleteFlyer,
  deleteMaster,
  flyers as fetchFlyers,
  masters as fetchMasters,
  updateFlyer,
  updateMaster,
} from './api'
import type { StammdatenItem } from './api'
import PencilIcon from './PencilIcon'
import TrashIcon from './TrashIcon'

interface CrewListProps {
  title: string
  // Camera flyers carry an email; tandem masters do not.
  withEmail: boolean
  load: () => Promise<StammdatenItem[]>
  add: (name: string, email?: string) => Promise<{ id: number }>
  update: (id: number, name: string, email: string) => Promise<StammdatenItem>
  remove: (id: number) => Promise<void>
}

// The row currently being edited. One per list (Tandemmaster and Kameraflieger
// each have their own): opening another row in the same list discards the
// unsaved values of the first.
interface Draft {
  id: number
  name: string
  email: string
}

// Mirrors the server check in src/server/routes/stammdaten.ts.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// An empty email is valid (it is optional); a non-empty one must match.
function isEmailValid(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || EMAIL_PATTERN.test(trimmed)
}

function CrewList({ title, withEmail, load, add, update, remove }: CrewListProps) {
  const [items, setItems] = useState<StammdatenItem[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const addEmailInvalid = withEmail && !isEmailValid(email)
  const draftEmailInvalid = withEmail && draft !== null && !isEmailValid(draft.email)

  const refresh = useCallback(() => {
    load().then(setItems).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler'))
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleAdd() {
    const trimmed = name.trim()
    if (!trimmed || addEmailInvalid) return
    const trimmedEmail = email.trim()
    setBusy(true)
    setError(null)
    try {
      await add(trimmed, withEmail && trimmedEmail ? trimmedEmail : undefined)
      setName('')
      setEmail('')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(item: StammdatenItem) {
    setError(null)
    setDraft({ id: item.id, name: item.name, email: item.email ?? '' })
  }

  async function handleSave() {
    if (busy || !draft || !draft.name.trim() || draftEmailInvalid) return
    setBusy(true)
    setError(null)
    try {
      await update(draft.id, draft.name.trim(), draft.email.trim())
      setDraft(null)
      refresh()
    } catch (err) {
      // The row stays open so the entry can be corrected and saved again.
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function handleDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (busy) return
    if (e.key === 'Enter') handleSave()
    else if (e.key === 'Escape') setDraft(null)
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
    <section className="crew-list">
      <h2>{title}</h2>
      {error && <p className="error">{error}</p>}
      {/* Above the list: it stays in the same place however long the list grows. */}
      <div className="add-row">
        <input
          type="text"
          value={name}
          placeholder="Vorname Nachname"
          onChange={(e) => setName(e.target.value)}
        />
        {withEmail && (
          <input
            type="email"
            value={email}
            placeholder="E-Mail (optional)"
            aria-invalid={addEmailInvalid}
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <button type="button" className="btn primary" onClick={handleAdd} disabled={busy || !name.trim() || addEmailInvalid}>
          Hinzufügen
        </button>
      </div>
      <ul>
        {items.map((item) =>
          draft?.id === item.id ? (
            <li key={item.id} className="crew-edit">
              <div className="crew-edit-fields">
                <input
                  type="text"
                  aria-label="Name"
                  value={draft.name}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={handleDraftKey}
                />
                {withEmail && (
                  <input
                    type="email"
                    aria-label="E-Mail"
                    placeholder="keine E-Mail"
                    aria-invalid={draftEmailInvalid}
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    onKeyDown={handleDraftKey}
                  />
                )}
              </div>
              <div className="crew-edit-actions">
                <button type="button" className="btn secondary" onClick={() => setDraft(null)} disabled={busy}>
                  Abbrechen
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={handleSave}
                  disabled={busy || !draft.name.trim() || draftEmailInvalid}
                >
                  Speichern
                </button>
              </div>
            </li>
          ) : (
            <li key={item.id}>
              <div className="crew-entry">
                <span>{item.name}</span>
                {withEmail && item.email && <span className="crew-email">{item.email}</span>}
              </div>
              <div className="crew-actions">
                <button
                  type="button"
                  className="btn secondary btn-icon"
                  onClick={() => startEdit(item)}
                  disabled={busy}
                  aria-label={`${item.name} bearbeiten`}
                  title="Bearbeiten"
                >
                  <PencilIcon />
                </button>
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
              </div>
            </li>
          ),
        )}
        {items.length === 0 && <li className="hint">Keine Einträge.</li>}
      </ul>
    </section>
  )
}

export default function Crew() {
  return (
    <div className="crew-screen">
      <CrewList
        title="Tandemmaster"
        withEmail={false}
        load={fetchMasters}
        add={addMaster}
        update={updateMaster}
        remove={deleteMaster}
      />
      <CrewList
        title="Kameraflieger"
        withEmail
        load={fetchFlyers}
        add={addFlyer}
        update={updateFlyer}
        remove={deleteFlyer}
      />
    </div>
  )
}
