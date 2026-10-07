# Urkunde PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Urkunde drucken" produces a complete certificate PDF built from the new `Urkunde.pdf` template, with the guest's name centred above the name line and the jump date centred on the date line after "Flugplatz Freistadt, am".

**Architecture:** Replace the current browser-print overlay (`Urkunde.tsx` + `urkunde.css`, made for pre-printed paper) with a server-generated PDF, exactly like the contract: a new `src/server/urkundePdf.ts` draws onto `assets/Urkunde.pdf` with pdf-lib and the embedded DejaVu fonts; a new route `GET /api/registrations/:id/urkunde.pdf` serves it inline; the manifest's "Urkunde drucken" becomes a link that opens the PDF in a new tab (same as "Vertrag öffnen"), where the operator prints it on plain paper.

**Tech Stack:** TypeScript, Fastify, pdf-lib + @pdf-lib/fontkit, better-sqlite3, React (manifest), Vitest + Testing Library.

## Global Constraints

- Code, identifiers, comments, log messages and commit messages in English (CLAUDE.md). UI text stays German.
- Template measured with PyMuPDF: single page, A4 portrait, 595.2756 x 841.8898 pt, no rotation.
- Measured lines (converted to pdf-lib's bottom-left origin, `y = 841.8898 - y_top`):
  - Name line: x 151.39 to 560.89, y 427.04 (centre x 356.14)
  - Date line: x 270.71 to 376.17, y 167.42 (centre x 323.44)
  - Label "Flugplatz Freistadt, am": ArialMT 12 pt, baseline at about y 168.1
- Name: DejaVu Sans Condensed **Bold**, 24 pt, baseline 8 pt above the name line, shrunk to fit if wider than the line minus 10 pt on each side.
- Date: DejaVu Sans Condensed regular, 12 pt (matches the label), baseline 2 pt above the date line, format `DD.MM.YYYY` from `jump_date`.
- Fonts must be the embedded DejaVu ones, never pdf-lib standard fonts (Czech/Polish/Turkish names, see `src/server/contractPdf.ts` header comment).
- Template ships in `assets/` (pkg bundles `assets/**/*`, see `pkg.config.json`).

---

## File Structure

- Move: `Urkunde.pdf` (repo root, untracked) to `assets/Urkunde.pdf` — the template.
- Modify: `src/server/contractPdf.ts` — export `embedFont` so the certificate reuses the font cache.
- Create: `src/server/urkundePdf.ts` — `fillUrkundePdf(template, { name, jumpDate })`, line coordinates, centring.
- Create: `tests/urkundePdf.test.ts`
- Create: `src/server/routes/urkunde.ts` — `registerUrkundeRoutes(app, db, urkundeTemplate)`.
- Create: `tests/urkunde-route.test.ts`
- Modify: `src/server/index.ts` — new `urkundeTemplate` parameter, registers the route.
- Modify: `src/server/main.ts` — reads `assets/Urkunde.pdf` at startup.
- Modify: `tests/helpers/testServer.ts` — passes the template.
- Modify: `web/manifest/src/api.ts` — `urkundePdfUrl(id)`.
- Modify: `web/manifest/src/Detail.tsx` — button becomes link.
- Modify: `web/manifest/src/Detail.test.tsx` — mock + assertion.
- Modify: `web/manifest/src/App.tsx`, `web/manifest/src/main.tsx` — drop the old print sheet.
- Delete: `web/manifest/src/Urkunde.tsx`, `web/manifest/src/Urkunde.test.tsx`, `web/manifest/src/urkunde.css`.

---

### Task 1: Certificate PDF generator

**Files:**
- Move: `Urkunde.pdf` to `assets/Urkunde.pdf`
- Modify: `src/server/contractPdf.ts` (the `embedFont` function, around line 47)
- Create: `src/server/urkundePdf.ts`
- Test: `tests/urkundePdf.test.ts`

**Interfaces:**
- Consumes: `embedFont(doc: PDFDocument, weight: 'regular' | 'bold'): Promise<PDFFont>` from `src/server/contractPdf.ts` (exported in this task).
- Produces:
  - `export interface UrkundeData { name: string; jumpDate: string }` (`jumpDate` is ISO `YYYY-MM-DD`)
  - `export async function fillUrkundePdf(templateBytes: Uint8Array, data: UrkundeData): Promise<Buffer>`
  - `export const NAME_LINE`, `export const DATE_LINE` (`{ x1: number; x2: number; y: number }`)

- [ ] **Step 1: Move the template into assets**

```bash
mv Urkunde.pdf assets/Urkunde.pdf
```

- [ ] **Step 2: Write the failing tests**

Create `tests/urkundePdf.test.ts`:

```ts
import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { fillUrkundePdf, NAME_LINE, DATE_LINE } from '../src/server/urkundePdf'
import { pdfText } from './helpers/pdfText'

const templateBytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'Urkunde.pdf'))

// pdf-lib positions every drawText with `1 0 0 1 <x> <y> Tm` right before the
// string's `Tj`; pdfText decodes the string, so both can be read back together.
function placement(text: string, drawn: string): { x: number; y: number } {
  const escaped = drawn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = text.match(new RegExp(`1 0 0 1 ([\\d.]+) ([\\d.]+) Tm\\s+${escaped} Tj`))
  if (!m) throw new Error(`"${drawn}" not found on the page`)
  return { x: Number(m[1]), y: Number(m[2]) }
}

test('returns a one-page PDF', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Anna Muster', jumpDate: '2026-07-09' })

  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  expect((await PDFDocument.load(buf)).getPageCount()).toBe(1)
})

test('prints the date as DD.MM.YYYY', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Anna Muster', jumpDate: '2026-07-09' })

  expect(await pdfText(buf)).toContain('09.07.2026')
})

test('a name outside WinAnsi reaches the certificate as itself', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Ondřej Nováček', jumpDate: '2026-07-09' })

  expect(await pdfText(buf)).toContain('Ondřej Nováček')
})

test('the name sits just above the name line, centred on it', async () => {
  const name = 'Anna Muster'
  const buf = await fillUrkundePdf(templateBytes, { name, jumpDate: '2026-07-09' })
  const doc = await PDFDocument.load(buf)
  const { x, y } = placement(await pdfText(buf), name)

  expect(y).toBeGreaterThan(NAME_LINE.y)
  expect(y).toBeLessThan(NAME_LINE.y + 15)
  // Centred: equal space left and right of the text on the line.
  const width = await textWidth(doc, name, 'bold', 24)
  expect(x - NAME_LINE.x1).toBeCloseTo(NAME_LINE.x2 - (x + width), 1)
})

test('the date sits on the date line, centred on it', async () => {
  const buf = await fillUrkundePdf(templateBytes, { name: 'Anna Muster', jumpDate: '2026-07-09' })
  const doc = await PDFDocument.load(buf)
  const { x, y } = placement(await pdfText(buf), '09.07.2026')

  expect(y).toBeGreaterThan(DATE_LINE.y)
  expect(y).toBeLessThan(DATE_LINE.y + 5)
  const width = await textWidth(doc, '09.07.2026', 'regular', 12)
  expect(x - DATE_LINE.x1).toBeCloseTo(DATE_LINE.x2 - (x + width), 1)
})

test('a very long name is shrunk to stay within the line', async () => {
  const name = 'Maximilian Alexander Konstantin von und zu Hohenberg-Schwarzenfeld'
  const buf = await fillUrkundePdf(templateBytes, { name, jumpDate: '2026-07-09' })
  const { x } = placement(await pdfText(buf), name)

  expect(x).toBeGreaterThanOrEqual(NAME_LINE.x1)
})

async function textWidth(
  doc: PDFDocument,
  text: string,
  weight: 'regular' | 'bold',
  size: number,
): Promise<number> {
  const { embedFont } = await import('../src/server/contractPdf')
  return (await embedFont(doc, weight)).widthOfTextAtSize(text, size)
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/urkundePdf.test.ts`
Expected: FAIL — `Cannot find module '../src/server/urkundePdf'`.

- [ ] **Step 4: Export `embedFont` from `src/server/contractPdf.ts`**

Change the declaration (comment above it stays):

```ts
export async function embedFont(doc: PDFDocument, weight: FontWeight): Promise<PDFFont> {
```

- [ ] **Step 5: Implement `src/server/urkundePdf.ts`**

```ts
import { PDFDocument, rgb } from 'pdf-lib'
import { embedFont } from './contractPdf'

export interface UrkundeData {
  name: string
  // ISO `YYYY-MM-DD`, as stored in registrations.jump_date.
  jumpDate: string
}

// The two blanks on assets/Urkunde.pdf (A4 portrait, 595x842 pt) are plain
// drawn lines, not form fields, so filling means drawing text above them.
// Measured off the template, in pdf-lib's bottom-left origin.
export const NAME_LINE = { x1: 151.39, x2: 560.89, y: 427.04 }
export const DATE_LINE = { x1: 270.71, x2: 376.17, y: 167.42 }

const NAME_SIZE = 24
// Keeps a long name from touching the ends of the line.
const NAME_PADDING = 10
// The date matches the 12 pt "Flugplatz Freistadt, am" printed before it.
const DATE_SIZE = 12

function centredX(line: { x1: number; x2: number }, width: number): number {
  return (line.x1 + line.x2) / 2 - width / 2
}

export async function fillUrkundePdf(
  templateBytes: Uint8Array,
  data: UrkundeData
): Promise<Buffer> {
  const doc = await PDFDocument.load(templateBytes)
  const [page] = doc.getPages()
  const bold = await embedFont(doc, 'bold')
  const regular = await embedFont(doc, 'regular')
  const black = rgb(0, 0, 0)

  const maxNameWidth = NAME_LINE.x2 - NAME_LINE.x1 - 2 * NAME_PADDING
  const fullWidth = bold.widthOfTextAtSize(data.name, NAME_SIZE)
  const nameSize = fullWidth > maxNameWidth ? NAME_SIZE * (maxNameWidth / fullWidth) : NAME_SIZE
  page.drawText(data.name, {
    x: centredX(NAME_LINE, bold.widthOfTextAtSize(data.name, nameSize)),
    y: NAME_LINE.y + 8,
    size: nameSize,
    font: bold,
    color: black,
  })

  const date = data.jumpDate.split('-').reverse().join('.')
  page.drawText(date, {
    x: centredX(DATE_LINE, regular.widthOfTextAtSize(date, DATE_SIZE)),
    y: DATE_LINE.y + 2,
    size: DATE_SIZE,
    font: regular,
    color: black,
  })

  return Buffer.from(await doc.save())
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/urkundePdf.test.ts tests/contractPdf.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Visual check**

Write a sample to the scratch dir and open it; confirm the name sits just above the long line and the date sits on the short line next to "Flugplatz Freistadt, am", neither touching the line.

```bash
npx tsx -e "import fs from 'fs'; import { fillUrkundePdf } from './src/server/urkundePdf'; fillUrkundePdf(fs.readFileSync('assets/Urkunde.pdf'), { name: 'Ondřej Nováček', jumpDate: '2026-07-09' }).then(b => fs.writeFileSync(process.env.TEMP + '/urkunde-sample.pdf', b))"
start "" "$TEMP/urkunde-sample.pdf"
```

If the offsets look off, adjust only the `+ 8` / `+ 2` baseline offsets and re-run Step 6.

- [ ] **Step 8: Commit**

```bash
git add assets/Urkunde.pdf src/server/contractPdf.ts src/server/urkundePdf.ts tests/urkundePdf.test.ts
git commit -m "feat(server): fill the Urkunde PDF template with guest name and jump date"
```

---

### Task 2: Serve the certificate

**Files:**
- Create: `src/server/routes/urkunde.ts`
- Modify: `src/server/index.ts:20-39` (signature + registration)
- Modify: `src/server/main.ts:103` and `:144` (load template, pass it)
- Modify: `tests/helpers/testServer.ts`
- Test: `tests/urkunde-route.test.ts`

**Interfaces:**
- Consumes: `fillUrkundePdf(templateBytes, { name, jumpDate })` from Task 1.
- Produces: `GET /api/registrations/:id/urkunde.pdf` returns `application/pdf`, `Content-Disposition: inline`; 404 for an unknown id. `buildServer(db, cfgRef, contractTemplate, urkundeTemplate, persist?, notify?, pickPath?, shutdown?, update?)`.

- [ ] **Step 1: Write the failing test**

Create `tests/urkunde-route.test.ts`:

```ts
import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'
import { pdfText } from './helpers/pdfText'
import { today } from '../src/server/day'

const validBody = () => ({
  first_name: 'Ondřej', last_name: 'Nováček', gender: 'male', age: 30,
  height_cm: 180, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  accepted_terms: true, privacy_ack: true,
})

test('serves the certificate with the guest name and jump date', async () => {
  const { app } = testServer()
  const create = await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })
  expect(create.statusCode).toBe(201)
  const { id } = create.json()

  const res = await app.inject({ method: 'GET', url: `/api/registrations/${id}/urkunde.pdf` })

  expect(res.statusCode).toBe(200)
  expect(res.headers['content-type']).toBe('application/pdf')
  expect(res.headers['content-disposition']).toBe('inline')
  const text = await pdfText(res.rawPayload)
  expect(text).toContain('Ondřej Nováček')
  expect(text).toContain(today().split('-').reverse().join('.'))
  await app.close()
})

test('404 for an unknown registration', async () => {
  const { app } = testServer()

  const res = await app.inject({ method: 'GET', url: '/api/registrations/999/urkunde.pdf' })

  expect(res.statusCode).toBe(404)
  await app.close()
})
```

(`POST /api/registrations` answers `201 { id }`, see `src/server/routes/registrations.ts:131`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/urkunde-route.test.ts`
Expected: FAIL — first test gets 404 (route missing).

- [ ] **Step 3: Create `src/server/routes/urkunde.ts`**

```ts
import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { fillUrkundePdf } from '../urkundePdf'

// Drawn on demand rather than stored: unlike the signed contract, the
// certificate carries nothing that is not already in the row.
export function registerUrkundeRoutes(app: FastifyInstance, db: Database, urkundeTemplate: Buffer) {
  app.get('/api/registrations/:id/urkunde.pdf', async (req, reply) => {
    const id = (req.params as any).id
    const row = db.prepare('SELECT first_name, last_name, jump_date FROM registrations WHERE id=?').get(id) as
      { first_name: string; last_name: string; jump_date: string } | undefined
    if (!row) return reply.code(404).send()
    const pdf = await fillUrkundePdf(urkundeTemplate, {
      name: `${row.first_name} ${row.last_name}`,
      jumpDate: row.jump_date,
    })
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', 'inline')
    return reply.send(pdf)
  })
}
```

- [ ] **Step 4: Wire it into `src/server/index.ts`**

Add the import next to the other route imports:

```ts
import { registerUrkundeRoutes } from './routes/urkunde'
```

Add the parameter directly after `contractTemplate`:

```ts
  contractTemplate: Buffer,
  urkundeTemplate: Buffer,
  persist?: (c: Config) => void,
```

Register it after `registerRegistrationRoutes(...)`:

```ts
  registerUrkundeRoutes(app, db, urkundeTemplate)
```

- [ ] **Step 5: Pass the template in `src/server/main.ts`**

After `const contractTemplate = fs.readFileSync(assetPath('Befoerderungsvertrag.pdf'))`:

```ts
const urkundeTemplate = fs.readFileSync(assetPath('Urkunde.pdf'))
```

And the call:

```ts
const app = buildServer(db, cfgRef, contractTemplate, urkundeTemplate, (c) => saveConfig(dir, c), notify, pickPath,
  () => { void shutdown('Beenden über das Manifest') }, updateControls)
```

- [ ] **Step 6: Pass the template in `tests/helpers/testServer.ts`**

Below `templateBytes`:

```ts
const urkundeBytes = fs.readFileSync(
  path.join(__dirname, '..', '..', 'assets', 'Urkunde.pdf')
)
```

And the call:

```ts
    app: buildServer(db, cfgRef, templateBytes, urkundeBytes, undefined, notify, pickPath, shutdown, update),
```

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run tests/urkunde-route.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Run the full server suite**

Run: `npx vitest run tests`
Expected: PASS (every test uses `testServer`, so a wrong argument order shows up here).

- [ ] **Step 9: Commit**

```bash
git add src/server/routes/urkunde.ts src/server/index.ts src/server/main.ts tests/helpers/testServer.ts tests/urkunde-route.test.ts
git commit -m "feat(server): serve the filled Urkunde as a PDF"
```

---

### Task 3: Manifest opens the PDF instead of printing the overlay

**Files:**
- Modify: `web/manifest/src/api.ts:291` (after `contractPdfUrl`)
- Modify: `web/manifest/src/Detail.tsx:2-5` (import), `:656-666` (button)
- Modify: `web/manifest/src/Detail.test.tsx:15` (mock), `:832` (assertion)
- Modify: `web/manifest/src/App.tsx:11`, `:200-207`, `:209`
- Modify: `web/manifest/src/main.tsx:4`
- Delete: `web/manifest/src/Urkunde.tsx`, `web/manifest/src/Urkunde.test.tsx`, `web/manifest/src/urkunde.css`

**Interfaces:**
- Consumes: `GET /api/registrations/:id/urkunde.pdf` from Task 2.
- Produces: `export function urkundePdfUrl(id: number): string` in `web/manifest/src/api.ts`.

- [ ] **Step 1: Update the test first**

In `web/manifest/src/Detail.test.tsx`, add to the `vi.mock('./api', ...)` factory next to `contractPdfUrl`:

```ts
  urkundePdfUrl: vi.fn(() => '/api/registrations/1/urkunde.pdf'),
```

Replace line 832:

```ts
    expect(actions.getByRole('link', { name: 'Urkunde drucken' }))
      .toHaveAttribute('href', '/api/registrations/1/urkunde.pdf')
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run web/manifest/src/Detail.test.tsx`
Expected: FAIL — no link named "Urkunde drucken" (it is still a button).

- [ ] **Step 3: Add `urkundePdfUrl` to `web/manifest/src/api.ts`**

Below `contractPdfUrl`:

```ts
export function urkundePdfUrl(id: number): string {
  return apiUrl(`/api/registrations/${id}/urkunde.pdf`)
}
```

- [ ] **Step 4: Replace the button in `web/manifest/src/Detail.tsx`**

Add `urkundePdfUrl` to the `./api` import (next to `contractPdfUrl`). Replace the JSX comment and `<button ... onClick={() => window.print()}>Urkunde drucken</button>` with:

```tsx
        {/*
          Opens the filled certificate in the browser's PDF viewer, where it is
          printed like the contract. The whole page comes from the server, so
          plain paper is enough.
        */}
        <a
          className="btn secondary"
          href={urkundePdfUrl(registration.id)}
          target="_blank"
          rel="noreferrer"
        >
          Urkunde drucken
        </a>
```

- [ ] **Step 5: Remove the old print sheet**

```bash
git rm web/manifest/src/Urkunde.tsx web/manifest/src/Urkunde.test.tsx web/manifest/src/urkunde.css
```

In `web/manifest/src/main.tsx` delete `import './urkunde.css'`.

In `web/manifest/src/App.tsx`:
- delete `import Urkunde from './Urkunde'`
- delete the JSX comment block about the print sheet and `{selected && <Urkunde registration={selected} />}`
- change `<div className="app-root no-print">` to `<div className="app-root">` (`no-print` was only defined in `urkunde.css`)

If the fragment `<>...</>` in App.tsx now wraps a single child, leave it; removing it is not required.

Then confirm nothing else references the removed pieces:

```bash
grep -rn "Urkunde'\|urkunde.css\|no-print\|print-only\|window.print" web/manifest/src
```

Expected: no output.

- [ ] **Step 6: Run manifest tests, typecheck and build**

Run: `npx vitest run web/manifest && npm --prefix web/manifest run build`
Expected: PASS, manifest build (includes its typecheck) succeeds.

- [ ] **Step 7: Manual check in the real app**

Start the app (`npm start`), open a registration in the manifest, click "Urkunde drucken": a new tab shows the certificate with the guest's name above the line and the jump date after "Flugplatz Freistadt, am". Print preview (Ctrl+P) shows one A4 portrait page.

- [ ] **Step 8: Commit**

```bash
git add -A web/manifest/src
git commit -m "feat(manifest): print the Urkunde from the generated PDF"
```

---

## Self-Review Notes

- Spec coverage: new PDF as base (Task 1 Step 1, Task 2 Step 5); name centred above the line (Task 1 test + `NAME_LINE`); date next to "Flugplatz Freistadt, am", centred on its line (Task 1 test + `DATE_LINE`); print function updated (Task 3).
- Branch: current branch `feature/flyer-email` is unrelated work in progress — execute this plan on its own branch off `main`.
