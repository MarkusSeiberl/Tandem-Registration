# Camera Flyer Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camera flyers get an optional, editable email; crew names (masters and flyers) become editable in the Crew screen.

**Architecture:** New nullable `email` column on `camera_flyers` (with startup migration). The generic `/api/:kind` stammdaten route gains a shared validation helper and a `PATCH /api/:kind/:id`. The manifest's `CrewList` gets inline row editing and, for flyers only, an email field.

**Tech Stack:** Node + Fastify + better-sqlite3 (server, vitest in `tests/`), React 19 + Vite (manifest, vitest + Testing Library in `web/manifest/src`).

Spec: `docs/superpowers/specs/2026-10-07-flyer-email-design.md`

## Global Constraints

- Code, identifiers, comments, commit messages: English only. User-facing UI text: German.
- Email is optional; empty or missing is stored as `NULL`. Existing flyers are not backfilled.
- Email regex (server): `^[^\s@]+@[^\s@]+\.[^\s@]+$`.
- Error messages (exact): `Name fehlt`, `E-Mail ungültig`, `E-Mail nur für Kameraflieger`.
- Registrations, Detail, export, Excel, payouts stay untouched.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Root tests: `npx vitest run <file>` from repo root. Manifest tests: `npm --prefix web/manifest test -- <pattern>`.

---

### Task 1: `email` column on `camera_flyers`

**Files:**
- Modify: `src/server/db.ts` (CREATE TABLE camera_flyers; `migrate()`)
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: table `camera_flyers(id, name, active, email TEXT NULL)` on fresh and migrated databases.

- [ ] **Step 1: Write the failing tests**

Append to `tests/db.test.ts` (the file already imports `Database`, `fs`, `os`, `path`, `openDb` and has the `tmpDirs` + `afterEach` cleanup):

```ts
test('creates camera_flyers with an email column', () => {
  const db = openDb(':memory:')
  const names = (db.pragma('table_info(camera_flyers)') as Array<{ name: string }>).map(c => c.name)
  expect(names).toEqual(['id', 'name', 'active', 'email'])
  db.close()
})

test('migration adds email to an existing camera_flyers table, existing flyers stay without one', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-db-test-'))
  tmpDirs.push(dir)
  const file = path.join(dir, 'tandem.db')
  // The camera_flyers schema shipped before the email column existed.
  const legacy = new Database(file)
  legacy.exec(`CREATE TABLE camera_flyers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1)`)
  legacy.prepare("INSERT INTO camera_flyers (name,active) VALUES ('Peter',1)").run()
  legacy.close()

  const db = openDb(file)
  const names = (db.pragma('table_info(camera_flyers)') as Array<{ name: string }>).map(c => c.name)
  expect(names).toContain('email')
  expect(db.prepare("SELECT email FROM camera_flyers WHERE name='Peter'").get()).toEqual({ email: null })
  db.close()
  // Second open must be a no-op, not a "duplicate column" error.
  openDb(file).close()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/db.test.ts`
Expected: both new tests FAIL (`email` missing from column list).

- [ ] **Step 3: Implement**

In `src/server/db.ts`, change the camera_flyers CREATE TABLE to:

```ts
    CREATE TABLE IF NOT EXISTS camera_flyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1,
      email TEXT);
```

At the end of `migrate()`, after the two `DROP COLUMN` lines, add:

```ts

  // Where a flyer gets the contacts of the guests they filmed. NULL on a
  // migrated row: flyers added before this column existed have no email yet.
  const flyerColumns = new Set(
    (db.pragma('table_info(camera_flyers)') as { name: string }[]).map(c => c.name))
  if (!flyerColumns.has('email')) db.exec('ALTER TABLE camera_flyers ADD COLUMN email TEXT')
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/db.ts tests/db.test.ts
git commit -m "feat(server): add an optional email column to camera flyers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stammdaten route — email and PATCH

**Files:**
- Modify: `src/server/routes/stammdaten.ts` (full rewrite below)
- Test: `tests/stammdaten.test.ts`

**Interfaces:**
- Consumes: `camera_flyers.email` from Task 1.
- Produces (HTTP):
  - `GET /api/flyers` → `[{ id, name, email }]`; `GET /api/masters` → `[{ id, name }]`
  - `POST /api/:kind` body `{ name: string, email?: string }` → 201 `{ id }`
  - `PATCH /api/:kind/:id` body `{ name: string, email?: string }` → 200 updated row (`{ id, name, email }` for flyers, `{ id, name }` for masters); 404 unknown/inactive id
  - 400 bodies: `{ error: 'Name fehlt' | 'E-Mail ungültig' | 'E-Mail nur für Kameraflieger' }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/stammdaten.test.ts`:

```ts
test('flyer can be added with an email', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter', email: ' peter@example.at ' } })
  expect(res.statusCode).toBe(201)
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()).toEqual([{ id: res.json().id, name: 'Peter', email: 'peter@example.at' }])
  await app.close()
})

test('flyer without email is stored with null', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Anna', email: '  ' } })
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()[0].email).toBeNull()
  await app.close()
})

test('invalid email returns 400', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter', email: 'peter.example.at' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'E-Mail ungültig' })
  await app.close()
})

test('email on a tandem master returns 400', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans', email: 'hans@example.at' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'E-Mail nur für Kameraflieger' })
  await app.close()
})

test('masters list carries no email key', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })
  const list = await app.inject({ method: 'GET', url: '/api/masters' })
  expect(Object.keys(list.json()[0])).toEqual(['id', 'name'])
  await app.close()
})

test('PATCH changes a flyer name and email', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: 'Peter Huber', email: 'peter@example.at' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id, name: 'Peter Huber', email: 'peter@example.at' })
  await app.close()
})

test('PATCH with an empty email clears it', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter', email: 'peter@example.at' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: 'Peter', email: '' } })
  expect(res.json().email).toBeNull()
  await app.close()
})

test('PATCH renames a tandem master', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/masters/${id}`, payload: { name: 'Hans Maier' } })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ id, name: 'Hans Maier' })
  await app.close()
})

test('PATCH with an empty name returns 400', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })).json()
  const res = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: ' ' } })
  expect(res.statusCode).toBe(400)
  expect(res.json()).toEqual({ error: 'Name fehlt' })
  await app.close()
})

test('PATCH of an unknown or removed entry returns 404', async () => {
  const { app } = testServer()
  const unknown = await app.inject({ method: 'PATCH', url: '/api/flyers/999', payload: { name: 'X' } })
  expect(unknown.statusCode).toBe(404)
  const { id } = (await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })).json()
  await app.inject({ method: 'DELETE', url: `/api/flyers/${id}` })
  const removed = await app.inject({ method: 'PATCH', url: `/api/flyers/${id}`, payload: { name: 'Peter' } })
  expect(removed.statusCode).toBe(404)
  await app.close()
})

test('PATCH of an unknown kind returns 404', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'PATCH', url: '/api/bogus/1', payload: { name: 'X' } })
  expect(res.statusCode).toBe(404)
  await app.close()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/stammdaten.test.ts`
Expected: new tests FAIL (email not stored/returned, PATCH 404 route not found). The four existing tests still PASS.

- [ ] **Step 3: Implement**

Replace `src/server/routes/stammdaten.ts` with:

```ts
import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'

const TABLE: Record<string, string> = { masters: 'tandem_masters', flyers: 'camera_flyers' }

// Only camera flyers carry an email: it is where the contacts of the guests
// they filmed will be sent, so they can deliver the video.
const WITH_EMAIL = new Set(['flyers'])
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const columns = (kind: string) => (WITH_EMAIL.has(kind) ? 'id,name,email' : 'id,name')

type CrewInput = { name: string; email: string | null }

// Shared by POST and PATCH. An empty or missing email is stored as NULL, so
// clearing the field in the edit row removes the address.
function parseCrewInput(kind: string, body: any): CrewInput | { error: string } {
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return { error: 'Name fehlt' }
  const email = typeof body?.email === 'string' ? body.email.trim() : ''
  if (!email) return { name, email: null }
  if (!WITH_EMAIL.has(kind)) return { error: 'E-Mail nur für Kameraflieger' }
  if (!EMAIL_PATTERN.test(email)) return { error: 'E-Mail ungültig' }
  return { name, email }
}

export function registerStammdatenRoutes(app: FastifyInstance, db: Database) {
  app.get('/api/:kind', async (req, reply) => {
    const kind = (req.params as any).kind
    const t = TABLE[kind]
    if (!t) return reply.code(404).send()
    return db.prepare(`SELECT ${columns(kind)} FROM ${t} WHERE active=1 ORDER BY name`).all()
  })

  app.post('/api/:kind', async (req, reply) => {
    const kind = (req.params as any).kind
    const t = TABLE[kind]
    if (!t) return reply.code(404).send()
    const input = parseCrewInput(kind, req.body)
    if ('error' in input) return reply.code(400).send(input)
    const i = WITH_EMAIL.has(kind)
      ? db.prepare(`INSERT INTO ${t} (name,email,active) VALUES (?,?,1)`).run(input.name, input.email)
      : db.prepare(`INSERT INTO ${t} (name,active) VALUES (?,1)`).run(input.name)
    return reply.code(201).send({ id: i.lastInsertRowid })
  })

  app.patch('/api/:kind/:id', async (req, reply) => {
    const { kind, id } = req.params as any
    const t = TABLE[kind]
    if (!t) return reply.code(404).send()
    const input = parseCrewInput(kind, req.body)
    if ('error' in input) return reply.code(400).send(input)
    // A removed entry stays in the table (soft delete) but is not editable.
    const r = WITH_EMAIL.has(kind)
      ? db.prepare(`UPDATE ${t} SET name=?, email=? WHERE id=? AND active=1`).run(input.name, input.email, id)
      : db.prepare(`UPDATE ${t} SET name=? WHERE id=? AND active=1`).run(input.name, id)
    if (r.changes === 0) return reply.code(404).send()
    return db.prepare(`SELECT ${columns(kind)} FROM ${t} WHERE id=?`).get(id)
  })

  app.delete('/api/:kind/:id', async (req, reply) => {
    const t = TABLE[(req.params as any).kind]
    if (!t) return reply.code(404).send()
    db.prepare(`UPDATE ${t} SET active=0 WHERE id=?`).run((req.params as any).id)
    return reply.code(204).send()
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/stammdaten.test.ts`
Expected: all PASS.

Then the full server suite to make sure nothing else used the old shape:
Run: `npx vitest run`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/stammdaten.ts tests/stammdaten.test.ts
git commit -m "feat(server): edit crew entries and store a flyer email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Manifest — API client and inline crew editing

**Files:**
- Modify: `web/manifest/src/api.ts` (`StammdatenItem`, `addKind`, new `updateKind`, exports)
- Create: `web/manifest/src/PencilIcon.tsx`
- Modify: `web/manifest/src/Crew.tsx` (full rewrite below)
- Modify: `web/manifest/src/index.css` (after the `.crew-list li:last-child` rule, ~line 1112)
- Test: `web/manifest/src/Crew.test.tsx`

**Interfaces:**
- Consumes: HTTP API from Task 2.
- Produces (`api.ts`):
  - `interface StammdatenItem { id: number; name: string; email?: string | null }`
  - `addFlyer(name: string, email?: string): Promise<{ id: number }>`
  - `updateMaster(id: number, name: string): Promise<StammdatenItem>`
  - `updateFlyer(id: number, name: string, email: string): Promise<StammdatenItem>`

- [ ] **Step 1: Write the failing tests**

Replace `web/manifest/src/Crew.test.tsx` with:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Crew from './Crew'
import * as api from './api'

vi.mock('./api', () => ({
  masters: vi.fn(),
  flyers: vi.fn(),
  addMaster: vi.fn(),
  addFlyer: vi.fn(),
  updateMaster: vi.fn(),
  updateFlyer: vi.fn(),
  deleteMaster: vi.fn(),
  deleteFlyer: vi.fn(),
}))

describe('Crew', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter', email: 'peter@example.at' }])
    vi.mocked(api.addFlyer).mockResolvedValue({ id: 8 })
    vi.mocked(api.updateFlyer).mockResolvedValue({ id: 7, name: 'Peter Huber', email: 'peter@example.at' })
    vi.mocked(api.updateMaster).mockResolvedValue({ id: 1, name: 'Hans Maier' })
  })

  it('lists the crew', async () => {
    render(<Crew />)

    expect(await screen.findByText('Hans')).toBeInTheDocument()
    expect(screen.getByText('Peter')).toBeInTheDocument()
  })

  it('asks for first and last name above each list', async () => {
    render(<Crew />)
    const hans = await screen.findByText('Hans')
    const peter = screen.getByText('Peter')

    const inputs = screen.getAllByPlaceholderText('Vorname Nachname')
    expect(inputs).toHaveLength(2)
    // Document order, not looks: the field comes before the names it adds to.
    expect(inputs[0].compareDocumentPosition(hans) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(inputs[1].compareDocumentPosition(peter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('carries only the crew, the amounts live on Tarife', async () => {
    render(<Crew />)
    await screen.findByText('Hans')

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Tandemmaster', 'Kameraflieger'])
    expect(screen.queryByText('Preise (EUR)')).not.toBeInTheDocument()
  })

  it('offers an email field only for camera flyers', async () => {
    render(<Crew />)
    await screen.findByText('Hans')

    const emailInputs = screen.getAllByPlaceholderText('E-Mail (optional)')
    expect(emailInputs).toHaveLength(1)
    const flyerHeading = screen.getByRole('heading', { name: 'Kameraflieger' })
    expect(flyerHeading.compareDocumentPosition(emailInputs[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows a flyer email under the name', async () => {
    render(<Crew />)

    expect(await screen.findByText('peter@example.at')).toBeInTheDocument()
  })

  it('adds a flyer with an email', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    await user.type(screen.getByPlaceholderText('E-Mail (optional)'), 'max@example.at')
    await user.click(screen.getAllByRole('button', { name: 'Hinzufügen' })[1])

    expect(api.addFlyer).toHaveBeenCalledWith('Max Muster', 'max@example.at')
  })

  it('adds a flyer without an email', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await screen.findByText('Peter')

    await user.type(screen.getAllByPlaceholderText('Vorname Nachname')[1], 'Max Muster')
    await user.click(screen.getAllByRole('button', { name: 'Hinzufügen' })[1])

    expect(api.addFlyer).toHaveBeenCalledWith('Max Muster', undefined)
  })

  it('edits a flyer inline and reloads the list', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    const name = screen.getByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('Peter')
    expect(screen.getByRole('textbox', { name: 'E-Mail' })).toHaveValue('peter@example.at')
    await user.clear(name)
    await user.type(name, 'Peter Huber')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(api.updateFlyer).toHaveBeenCalledWith(7, 'Peter Huber', 'peter@example.at')
    expect(api.flyers).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()
  })

  it('cancelling the edit keeps the entry unchanged', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))

    await user.type(screen.getByRole('textbox', { name: 'Name' }), ' Huber')
    await user.click(screen.getByRole('button', { name: 'Abbrechen' }))

    expect(api.updateFlyer).not.toHaveBeenCalled()
    expect(screen.getByText('Peter')).toBeInTheDocument()
  })

  it('edits a tandem master name without an email field', async () => {
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Hans bearbeiten' }))

    expect(screen.queryByRole('textbox', { name: 'E-Mail' })).not.toBeInTheDocument()
    const name = screen.getByRole('textbox', { name: 'Name' })
    await user.clear(name)
    await user.type(name, 'Hans Maier{Enter}')

    expect(api.updateMaster).toHaveBeenCalledWith(1, 'Hans Maier', '')
  })

  it('keeps the row in edit mode when saving fails', async () => {
    vi.mocked(api.updateFlyer).mockRejectedValue(new Error('E-Mail ungültig'))
    const user = userEvent.setup()
    render(<Crew />)
    await user.click(await screen.findByRole('button', { name: 'Peter bearbeiten' }))
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    const flyerList = screen.getByRole('heading', { name: 'Kameraflieger' }).closest('section')!
    expect(await within(flyerList).findByText('E-Mail ungültig')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
  })
})
```

Note: `updateMaster` is called by `CrewList` with the same three arguments as `updateFlyer` (`id, name, email`); for masters the email is always `''` and `updateMaster` ignores it. That is why the master test expects `(1, 'Hans Maier', '')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --prefix web/manifest test -- Crew`
Expected: the new tests FAIL (no email input, no `bearbeiten` buttons). The first three PASS.

- [ ] **Step 3: Update the API client**

In `web/manifest/src/api.ts`, change `StammdatenItem`:

```ts
export interface StammdatenItem {
  id: number
  name: string
  // Camera flyers only; null when none was entered.
  email?: string | null
}
```

Change `addKind` to take an optional email:

```ts
async function addKind(kind: StammdatenKind, name: string, email?: string): Promise<{ id: number }> {
  const res = await fetch(apiUrl(`/api/${kind}`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(email === undefined ? { name } : { name, email }),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Anlegen fehlgeschlagen'))
  return asJson<{ id: number }>(res)
}
```

Add after `addKind`:

```ts
async function updateKind(
  kind: StammdatenKind,
  id: number,
  fields: { name: string; email?: string },
): Promise<StammdatenItem> {
  const res = await fetch(apiUrl(`/api/${kind}/${id}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fields),
  })
  if (!res.ok) throw new Error(await errorMessage(res, 'Speichern fehlgeschlagen'))
  return asJson<StammdatenItem>(res)
}
```

Replace the six crew exports with:

```ts
export const masters = () => listKind('masters')
export const addMaster = (name: string) => addKind('masters', name)
export const updateMaster = (id: number, name: string) => updateKind('masters', id, { name })
export const deleteMaster = (id: number) => removeKind('masters', id)

export const flyers = () => listKind('flyers')
export const addFlyer = (name: string, email?: string) => addKind('flyers', name, email)
export const updateFlyer = (id: number, name: string, email: string) =>
  updateKind('flyers', id, { name, email })
export const deleteFlyer = (id: number) => removeKind('flyers', id)
```

- [ ] **Step 4: Add the pencil icon**

Create `web/manifest/src/PencilIcon.tsx`:

```tsx
export interface PencilIconProps {
  size?: number
}

// Edit glyph for the per-row Crew edit button, drawn to match TrashIcon.
export default function PencilIcon({ size = 18 }: PencilIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4zM13.5 6.5l4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
```

- [ ] **Step 5: Rewrite `Crew.tsx`**

Replace `web/manifest/src/Crew.tsx` with:

```tsx
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

// The row currently being edited. Only one at a time: opening another row
// discards the unsaved values of the first.
interface Draft {
  id: number
  name: string
  email: string
}

function CrewList({ title, withEmail, load, add, update, remove }: CrewListProps) {
  const [items, setItems] = useState<StammdatenItem[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
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
    if (!draft || !draft.name.trim()) return
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
            onChange={(e) => setEmail(e.target.value)}
          />
        )}
        <button type="button" className="btn primary" onClick={handleAdd} disabled={busy || !name.trim()}>
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
                  disabled={busy || !draft.name.trim()}
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
```

- [ ] **Step 6: Add styles**

In `web/manifest/src/index.css`, directly after the `.crew-list li:last-child { ... }` rule, insert:

```css
/* Name, email field and button no longer fit one line in a narrow list. */
.crew-list .add-row {
  flex-wrap: wrap;
}

.crew-list .add-row input {
  min-width: 140px;
}

.crew-entry {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.crew-email {
  font-size: 13px;
  opacity: 0.7;
  overflow-wrap: anywhere;
}

.crew-actions {
  display: flex;
  gap: 6px;
}

.crew-list li.crew-edit {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
}

.crew-edit-fields {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.crew-edit-fields input {
  font: inherit;
  padding: 8px 10px;
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--text);
}

.crew-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
```

- [ ] **Step 7: Run tests, typecheck, lint**

Run: `npm --prefix web/manifest test`
Expected: all PASS (whole manifest suite, since `StammdatenItem` and `api` mocks are shared with Detail/List tests).

Run: `cd web/manifest && npx tsc -b && npm run lint`
Expected: no errors. If oxlint flags `autoFocus` (jsx-a11y/no-autofocus), remove the `autoFocus` prop and report it rather than disabling the rule.

- [ ] **Step 8: Commit**

```bash
git add web/manifest/src/api.ts web/manifest/src/PencilIcon.tsx web/manifest/src/Crew.tsx web/manifest/src/Crew.test.tsx web/manifest/src/index.css
git commit -m "feat(manifest): edit crew inline and give camera flyers an email

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
