import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
import CheckIcon from './CheckIcon'
import CloseIcon from './CloseIcon'
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

const EMAIL_MESSAGE = 'Keine gültige E-Mail-Adresse.'

// Two entries with the same name cannot be told apart in the manifest's picker,
// and the payouts are split between them. Case and spacing do not make a
// different person.
function nameKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('de')
}

function CrewList({ title, withEmail, load, add, update, remove }: CrewListProps) {
  const [items, setItems] = useState<StammdatenItem[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // An email is only called malformed once its field was left or an add/save
  // was attempted: "max@" is not wrong yet, it is unfinished. Once the message
  // is showing it follows every keystroke, so it goes as soon as the address
  // is right.
  const [addEmailChecked, setAddEmailChecked] = useState(false)
  const [draftEmailChecked, setDraftEmailChecked] = useState(false)
  // Where the keyboard goes once the row it was on closes or disappears: a
  // row's pencil (by entry id) or the name field of the add row.
  const [focusTarget, setFocusTarget] = useState<number | 'add' | null>(null)
  const pencils = useRef(new Map<number, HTMLButtonElement>())
  const addNameInput = useRef<HTMLInputElement>(null)
  const addEmailInput = useRef<HTMLInputElement>(null)
  const draftEmailInput = useRef<HTMLInputElement>(null)

  const addEmailInvalid = withEmail && !isEmailValid(email)
  const draftEmailInvalid = withEmail && draft !== null && !isEmailValid(draft.email)
  const showAddEmailError = addEmailChecked && addEmailInvalid
  const showDraftEmailError = draftEmailChecked && draftEmailInvalid

  // The entry already carrying this name, if any. The row being edited does not
  // count against itself, so correcting only the case of a name still saves.
  const duplicateOf = (value: string, exceptId?: number) =>
    nameKey(value) === '' ? undefined : items.find((i) => i.id !== exceptId && nameKey(i.name) === nameKey(value))
  const addDuplicate = duplicateOf(name)
  const draftDuplicate = draft ? duplicateOf(draft.name, draft.id) : undefined

  const ids = useId()
  const headingId = `${ids}-heading`
  const addNameMessageId = `${ids}-add-name`
  const addEmailMessageId = `${ids}-add-email`
  const draftNameMessageId = `${ids}-edit-name`
  const draftEmailMessageId = `${ids}-edit-email`
  const renameNoteId = `${ids}-rename`

  const refresh = useCallback(() => {
    load().then(setItems).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler'))
  }, [load])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Runs after the commit that re-enabled the buttons (they are disabled while
  // busy, and a disabled button cannot take focus).
  useEffect(() => {
    if (focusTarget === null || busy) return
    const target = focusTarget === 'add' ? addNameInput.current : pencils.current.get(focusTarget)
    target?.focus()
    setFocusTarget(null)
  }, [focusTarget, busy, items, draft])

  async function handleAdd() {
    const trimmed = name.trim()
    // busy too: Enter can be pressed again while the first add is in flight.
    if (busy || !trimmed || addDuplicate) return
    if (addEmailInvalid) {
      setAddEmailChecked(true)
      addEmailInput.current?.focus()
      return
    }
    const trimmedEmail = email.trim()
    setBusy(true)
    setError(null)
    try {
      await add(trimmed, withEmail && trimmedEmail ? trimmedEmail : undefined)
      setName('')
      setEmail('')
      setAddEmailChecked(false)
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function startEdit(item: StammdatenItem) {
    setError(null)
    setDraftEmailChecked(false)
    setDraft({ id: item.id, name: item.name, email: item.email ?? '' })
  }

  function closeEdit() {
    if (draft) setFocusTarget(draft.id)
    setDraft(null)
  }

  async function handleSave() {
    if (busy || !draft || !draft.name.trim() || draftDuplicate) return
    if (draftEmailInvalid) {
      setDraftEmailChecked(true)
      draftEmailInput.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      await update(draft.id, draft.name.trim(), draft.email.trim())
      closeEdit()
      refresh()
    } catch (err) {
      // The row stays open so the entry can be corrected and saved again.
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function handleAddKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') handleAdd()
  }

  function handleDraftKey(e: KeyboardEvent<HTMLInputElement>) {
    if (busy) return
    if (e.key === 'Enter') handleSave()
    else if (e.key === 'Escape') closeEdit()
  }

  async function handleRemove(item: StammdatenItem) {
    if (!window.confirm(`"${item.name}" entfernen?`)) return
    // The row below takes the removed one's place; at the end of the list the
    // one above, and with nothing left the add field.
    const index = items.findIndex((i) => i.id === item.id)
    const next = items[index + 1] ?? items[index - 1]
    setBusy(true)
    setError(null)
    try {
      await remove(item.id)
      setFocusTarget(next ? next.id : 'add')
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  return (
    // A region named after its heading: both lists have a "Name" field and a
    // "Hinzufügen" button, and a screen reader has to tell which list it is in.
    <section className="crew-list" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      {error && <p className="error">{error}</p>}
      {/* Above the list: it stays in the same place however long the list grows. */}
      <div className="add-row">
        <label className="crew-field">
          <span>Name</span>
          <input
            ref={addNameInput}
            type="text"
            value={name}
            placeholder="Vorname Nachname"
            aria-invalid={addDuplicate !== undefined}
            aria-describedby={addDuplicate ? addNameMessageId : undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleAddKey}
          />
        </label>
        {withEmail && (
          <label className="crew-field">
            <span>E-Mail (optional)</span>
            <input
              ref={addEmailInput}
              type="email"
              value={email}
              placeholder="name@beispiel.at"
              aria-invalid={showAddEmailError}
              aria-describedby={showAddEmailError ? addEmailMessageId : undefined}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setAddEmailChecked(email.trim() !== '')}
              onKeyDown={handleAddKey}
            />
          </label>
        )}
        {/* Not disabled by a malformed email: clicking is how the operator
            finds out what is wrong with it. */}
        <button type="button" className="btn primary" onClick={handleAdd} disabled={busy || !name.trim() || addDuplicate !== undefined}>
          Hinzufügen
        </button>
      </div>
      {(addDuplicate || showAddEmailError) && (
        <div className="crew-add-messages">
          {addDuplicate && (
            <p className="field-error" id={addNameMessageId} role="alert">
              „{addDuplicate.name}“ ist schon in der Liste.
            </p>
          )}
          {showAddEmailError && (
            <p className="field-error" id={addEmailMessageId} role="alert">
              {EMAIL_MESSAGE}
            </p>
          )}
        </div>
      )}
      <ul>
        {items.map((item) =>
          draft?.id === item.id ? (
            <li key={item.id} className="crew-edit">
              <div className="crew-edit-fields">
                <input
                  type="text"
                  aria-label="Name ändern"
                  value={draft.name}
                  aria-invalid={draftDuplicate !== undefined}
                  aria-describedby={draftDuplicate ? `${draftNameMessageId} ${renameNoteId}` : renameNoteId}
                  autoFocus
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  onKeyDown={handleDraftKey}
                />
                {withEmail && (
                  <input
                    ref={draftEmailInput}
                    type="email"
                    aria-label="E-Mail ändern"
                    placeholder="keine E-Mail"
                    aria-invalid={showDraftEmailError}
                    aria-describedby={showDraftEmailError ? draftEmailMessageId : undefined}
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    onBlur={() => setDraftEmailChecked(draft.email.trim() !== '')}
                    onKeyDown={handleDraftKey}
                  />
                )}
                {draftDuplicate && (
                  <p className="field-error" id={draftNameMessageId} role="alert">
                    „{draftDuplicate.name}“ ist schon in der Liste.
                  </p>
                )}
                {showDraftEmailError && (
                  <p className="field-error" id={draftEmailMessageId} role="alert">
                    {EMAIL_MESSAGE}
                  </p>
                )}
                {/* Payouts and exports look names up when they are built, so a
                    rename reaches back into earlier days: it is for typos, not
                    for handing an entry to somebody else. */}
                <p className="crew-rename-note" id={renameNoteId}>
                  Der neue Name gilt auch für frühere Sprungtage.
                </p>
              </div>
              {/* Same slots as pencil and bin, so the row barely moves when editing. */}
              <div className="crew-actions">
                <button
                  type="button"
                  className="btn secondary btn-icon"
                  onClick={closeEdit}
                  disabled={busy}
                  aria-label="Abbrechen"
                  title="Abbrechen"
                >
                  <CloseIcon />
                </button>
                <button
                  type="button"
                  className="btn primary btn-icon"
                  onClick={handleSave}
                  disabled={busy || !draft.name.trim() || draftDuplicate !== undefined}
                  aria-label="Speichern"
                  title="Speichern"
                >
                  <CheckIcon />
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
                  ref={(el) => {
                    if (el) pencils.current.set(item.id, el)
                    else pencils.current.delete(item.id)
                  }}
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
