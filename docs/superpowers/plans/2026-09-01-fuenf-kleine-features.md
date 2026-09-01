# Fünf kleine Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five independent small features: guardian-signature note for minors (kiosk + contract PDF), contract PDFs survive registration deletion, minimum height 140 cm, non-negative load numbers, and the toolbar "Kassiert:" sum split into "Kassiert Bar" / "Kassiert Karte".

**Architecture:** Each feature is a self-contained task touching an existing validation rule, route, or React screen. No new modules except one small helper mirrored from `src/server/pricing.ts` into `web/manifest/src/pricing.ts` (the established server/web mirroring pattern). No DB migration needed anywhere.

**Tech Stack:** Fastify + better-sqlite3 + pdf-lib (server, tested with vitest via `npm test` in repo root), React + Vitest + Testing Library (web apps, tested with `npm --prefix web/guest test` and `npm --prefix web/manifest test`).

## Global Constraints

- All user-facing strings are German; the guardian phrase is verbatim: `gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre`.
- Minimum height is exactly **140 cm** (upper bound stays 220), enforced in BOTH `src/server/validation.ts` and `web/guest/src/Form.tsx` — they are deliberate mirrors.
- Load number: integer `>= 0` or `null`; anything else is a 400.
- Contract PDFs in `<exportDir>/vertaege/` are never deleted by the application.
- Server stays the single pricing/validation authority; web mirrors only for display.
- Run commands from repo root: `C:\Users\Markus\Documents\Git Projects\Tandem-Registration`.

---

### Task 1: Guardian note for minors (kiosk signature screen + contract PDF)

The guest kiosk shows a note at the signature pad when the guest is under 18, and the generated contract PDF carries the same caption under the signature blank.

**Files:**
- Modify: `web/guest/src/Contract.tsx` (props at lines 7–14, sign-section at lines 264–266)
- Modify: `web/guest/src/App.tsx:77-93` (pass the flag)
- Modify: `web/guest/src/index.css` (one new rule near `.missing-note`, line ~316)
- Modify: `src/server/contractPdf.ts` (PAGE2 block line 109, `fillContractPdf` line 147)
- Test: `web/guest/src/Contract.test.tsx`
- Test: `tests/contractPdf.test.ts`

**Interfaces:**
- Consumes: existing `ContractProps` (`web/guest/src/Contract.tsx:7`), existing `ContractPdfData.age` (`src/server/contractPdf.ts:61`).
- Produces: new optional prop `minor?: boolean` on `Contract`; no server API change (age already flows into `fillContractPdf`).

- [ ] **Step 1: Write the failing kiosk tests**

In `web/guest/src/Contract.test.tsx`, inside the existing `describe` (reuse the existing mock that resolves the contract text to `'Vertragstext hier.'`):

```tsx
  it('tells a minor that the legal guardian must sign', async () => {
    render(<Contract onNext={vi.fn()} minor />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    expect(
      screen.getByText('Unterschrift: gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre')
    ).toBeInTheDocument()
  })

  it('shows no guardian note for an adult', async () => {
    render(<Contract onNext={vi.fn()} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    expect(screen.queryByText(/gesetzlicher Vertreter/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web/guest test -- Contract`
Expected: the first new test FAILS (`Unable to find an element with the text: Unterschrift: gesetzlicher Vertreter …`); the adult test may already pass — that's fine.

- [ ] **Step 3: Implement the kiosk note**

In `web/guest/src/Contract.tsx` extend the props:

```tsx
export interface ContractProps {
  onNext: (signaturePng: string) => void
  onCancel?: () => void
  /** Back to the form, with what the guest already typed still in it. */
  onBack?: () => void
  submitting?: boolean
  errors?: string[] | null
  /** Guest is under 18 — the signature has to come from the legal guardian. */
  minor?: boolean
}
```

Add `minor` to the destructured parameters of `Contract(…)`. Then, in the sign-section (directly after the `<p>Mit deiner Unterschrift …</p>` line, before the `<canvas>`):

```tsx
          {minor && (
            <p className="minor-note">
              Unterschrift: gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre
            </p>
          )}
```

In `web/guest/src/index.css`, next to `.missing-note` (line ~316):

```css
.minor-note {
  margin: 4px 0 0;
  font-size: 17px;
  font-weight: 600;
}
```

In `web/guest/src/App.tsx`, where `<Contract` is rendered (line ~80), add the prop:

```tsx
          <Contract
            onNext={handleSign}
            onCancel={resetToWelcome}
            minor={formValues !== null && formValues.age < 18}
```

(the rest of the props stay unchanged).

- [ ] **Step 4: Run the kiosk tests to verify they pass**

Run: `npm --prefix web/guest test`
Expected: PASS (whole guest suite — the new prop is optional, nothing else changes).

- [ ] **Step 5: Write the failing PDF tests**

In `tests/contractPdf.test.ts` (uses the existing `templateBytes`, `sampleData`, `pdfText` from the top of the file):

```ts
test('a minor guest gets the guardian caption under the signature', async () => {
  const buf = await fillContractPdf(templateBytes, { ...sampleData(), age: 17 })

  const text = await pdfText(buf)
  expect(text).toContain('gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre')
})

test('an adult contract carries no guardian caption', async () => {
  const buf = await fillContractPdf(templateBytes, sampleData())

  const text = await pdfText(buf)
  expect(text).not.toContain('gesetzlicher Vertreter')
})
```

- [ ] **Step 6: Run the PDF tests to verify the minor one fails**

Run: `npx vitest run tests/contractPdf.test.ts`
Expected: minor test FAILS (caption not in text); adult test passes.

- [ ] **Step 7: Implement the PDF caption**

In `src/server/contractPdf.ts`, extend the `PAGE2` block (line ~109):

```ts
const PAGE2 = {
  ort: { x: 85, y: 82 },
  // The Datum blank is only ~60pt wide (right after the "Datum:" label,
  // before "Unterschrift:" starts around x=300) — too narrow for a full
  // dd.mm.yyyy date at 10pt, hence the smaller size here.
  datum: { x: 220, y: 82, size: 9 },
  signature: { x: 440, y: 84, width: 90, height: 36 },
  // Caption under the signature blank for guests under 18. Small enough to sit
  // beneath the pre-printed line without touching the page edge.
  guardian: { x: 360, y: 70, size: 7 },
}
```

In `fillContractPdf`, directly after `draw(page2, data.datum, PAGE2.datum)`:

```ts
  if (data.age < 18) {
    draw(page2, 'gesetzlicher Vertreter bei Minderjährigen unter 18 Jahre', PAGE2.guardian)
  }
```

- [ ] **Step 8: Run the PDF tests to verify they pass**

Run: `npx vitest run tests/contractPdf.test.ts tests/registrations.test.ts`
Expected: PASS.

- [ ] **Step 9: Visually verify the caption position (coordinates are measured, not derived)**

Generate one minor contract and open it:

```powershell
npx tsx -e "const fs=require('fs');(async()=>{const {fillContractPdf}=require('./src/server/contractPdf');const buf=await fillContractPdf(fs.readFileSync('assets/Befoerderungsvertrag.pdf'),{firstName:'Mia',lastName:'Muster',street:'X 1',postalCode:'4240',city:'Freistadt',phone:'0660',email:'a@b.at',age:16,heightCm:150,weightKg:45,ort:'Freistadt',datum:'01.09.2026',signaturePngDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='});fs.writeFileSync('minor-preview.pdf',buf)})()"
Start-Process minor-preview.pdf
```

Check the caption sits under the signature line on page 2 without overlapping "Unterschrift:" or the page edge. If it's off, adjust only `PAGE2.guardian.x/y` (the same measure-against-the-template workflow as every other coordinate in that file). Delete `minor-preview.pdf` afterwards — it is not committed.

- [ ] **Step 10: Commit**

```bash
git add web/guest/src/Contract.tsx web/guest/src/Contract.test.tsx web/guest/src/App.tsx web/guest/src/index.css src/server/contractPdf.ts tests/contractPdf.test.ts
git commit -m "feat(vertrag): Hinweis auf den gesetzlichen Vertreter bei Minderjährigen"
```

---

### Task 2: Contract PDFs survive deleting the registration

The DELETE route currently unlinks the generated contract PDF (`src/server/routes/registrations.ts:386-403`). The contract is a signed legal document — it stays on disk even when the row is removed from the application.

**Files:**
- Modify: `src/server/routes/registrations.ts:386-403`
- Test: `tests/registrations.test.ts:225-240`

**Interfaces:**
- Consumes: nothing new.
- Produces: no API change — `DELETE /api/registrations/:id` still returns 204/404; only the file-system side effect disappears.

- [ ] **Step 1: Rewrite the existing deletion test to assert the opposite**

Replace the test at `tests/registrations.test.ts:225-240` ("DELETE … also removes the generated contract PDF") with:

```ts
// The contract is a signed legal document. Deleting the row cleans up the
// application's view of the day; the PDF on disk is the club's record and
// stays, even if the entry was a mistake.
test('DELETE /api/registrations/:id keeps the generated contract PDF on disk', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-del-'))
  const { app } = testServer({ exportDir })
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()

  const rows = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()
  const filename = rows.find((r: any) => r.id === id).contract_pdf_filename
  const pdfPath = path.join(exportDir, 'vertaege', filename)
  expect(fs.existsSync(pdfPath)).toBe(true)

  const del = await app.inject({ method: 'DELETE', url: `/api/registrations/${id}` })
  expect(del.statusCode).toBe(204)
  expect(fs.existsSync(pdfPath)).toBe(true)

  await app.close()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/registrations.test.ts`
Expected: FAIL on the final `expect(fs.existsSync(pdfPath)).toBe(true)` — the route still unlinks the file.

- [ ] **Step 3: Remove the unlink from the DELETE route**

Replace the whole DELETE handler at `src/server/routes/registrations.ts:386-403` with:

```ts
  app.delete('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const result = db.prepare('DELETE FROM registrations WHERE id=?').run(id)
    if (result.changes === 0) return reply.code(404).send()

    // The generated contract PDF is deliberately left on disk: it is a signed
    // legal document, and removing the row must not destroy the club's record.

    sse.broadcast('changed', { id })
    return reply.code(204).send()
  })
```

(The pre-delete `SELECT contract_pdf_filename` and the `fs.unlink` block are gone — nothing else in the route used them.)

- [ ] **Step 4: Run the server suite to verify it passes**

Run: `npx vitest run tests/registrations.test.ts`
Expected: PASS, including the SSE and 404 delete tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/registrations.ts tests/registrations.test.ts
git commit -m "feat(vertrag): unterschriebene Verträge überleben das Löschen des Eintrags"
```

---

### Task 3: Minimum height 140 cm

Raise the lower bound from 100 to 140 in both validators (server `src/server/validation.ts:23`, kiosk `web/guest/src/Form.tsx:120` + the input's `min` attribute at line 346).

**Files:**
- Modify: `src/server/validation.ts:23`
- Modify: `web/guest/src/Form.tsx:120,346`
- Test: `tests/validation.test.ts`
- Test: `web/guest/src/Form.test.tsx:84-95`

**Interfaces:**
- Consumes: nothing new.
- Produces: `validateGuest` rejects `height_cm < 140`; error strings become `'Größe ungültig'` (server, unchanged wording) and `'Größe ungültig (140–220 cm)'` (kiosk).

- [ ] **Step 1: Rewrite the boundary test for the new floor**

`tests/validation.test.ts:39-45` already pins the height bounds (and asserts 100 is valid). Replace that whole test with (the `base` fixture is defined at the top of the file, `height_cm: 170`):

```ts
// Height boundaries and validation
test('height_cm boundaries', () => {
  expect(validateGuest({ ...base, height_cm:140 }).ok).toBe(true)
  expect(validateGuest({ ...base, height_cm:220 }).ok).toBe(true)
  expect(validateGuest({ ...base, height_cm:139 }).ok).toBe(false)
  expect(validateGuest({ ...base, height_cm:221 }).ok).toBe(false)
  expect(validateGuest({ ...base, height_cm:170.5 }).ok).toBe(false)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/validation.test.ts`
Expected: FAIL — 139 is currently accepted (lower bound is 100).

- [ ] **Step 3: Change the server bound**

In `src/server/validation.ts:23`:

```ts
  if (!int(input?.height_cm, 140, 220)) e.push('Größe ungültig')
```

- [ ] **Step 4: Run the server tests to verify they pass**

Run: `npx vitest run tests/validation.test.ts tests/registrations.test.ts`
Expected: PASS (registration fixtures use 170/182 cm, unaffected).

- [ ] **Step 5: Write the failing kiosk test**

In `web/guest/src/Form.test.tsx`, next to the existing `'rejects an out-of-range Größe'` test (line ~84), add:

```tsx
  it('rejects 139 cm and accepts the 140 cm minimum', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.clear(screen.getByLabelText('Größe (cm)'))
    await user.type(screen.getByLabelText('Größe (cm)'), '139')
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeDisabled()

    await user.clear(screen.getByLabelText('Größe (cm)'))
    await user.type(screen.getByLabelText('Größe (cm)'), '140')
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeEnabled()
  })
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm --prefix web/guest test -- Form`
Expected: FAIL — 139 currently enables the button.

- [ ] **Step 7: Change the kiosk bound**

In `web/guest/src/Form.tsx:120`:

```ts
  if (!isInt(v.height, 140, 220)) e.height = 'Größe ungültig (140–220 cm)'
```

And the input at line 346:

```tsx
              <input id="height_cm" type="number" inputMode="tel" min={140} max={220} {...field('height')} />
```

- [ ] **Step 8: Run the guest suite to verify it passes**

Run: `npm --prefix web/guest test`
Expected: PASS (the existing out-of-range test uses 95, still invalid).

- [ ] **Step 9: Commit**

```bash
git add src/server/validation.ts tests/validation.test.ts web/guest/src/Form.tsx web/guest/src/Form.test.tsx
git commit -m "feat(anmeldung): Mindestgröße 140 cm"
```

---

### Task 4: Load-Nr. must not be negative

The PATCH route accepts `load_number` unvalidated (`src/server/routes/registrations.ts:172-175` allowlist, checks start at line 194). Add a server check — `null` or integer `>= 0` — and give the manifest input a matching `min` attribute.

**Files:**
- Modify: `src/server/routes/registrations.ts` (insert after the `payment_method` check at line ~194)
- Modify: `web/manifest/src/Detail.tsx:341-346`
- Test: `tests/manifest-update.test.ts`

**Interfaces:**
- Consumes: existing PATCH allowlist entry `'load_number'`.
- Produces: `PATCH /api/registrations/:id` returns `400 { error: 'Load-Nr. ungültig' }` for negative or non-integer load numbers; `null` still clears the field.

- [ ] **Step 1: Write the failing server tests**

In `tests/manifest-update.test.ts` (same `validBody`/`testServer` pattern as the file's first test):

```ts
test('patch rejects a negative load number', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()
  const res = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: -1 }
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('Load-Nr. ungültig')
  await app.close()
})

test('patch rejects a fractional load number but allows clearing with null', async () => {
  const { app } = testServer()
  const { id } = (await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })).json()

  const frac = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: 2.5 }
  })
  expect(frac.statusCode).toBe(400)

  await app.inject({ method: 'PATCH', url: `/api/registrations/${id}`, payload: { load_number: 3 } })
  const cleared = await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { load_number: null }
  })
  expect(cleared.statusCode).toBe(200)
  expect(cleared.json().load_number).toBeNull()
  await app.close()
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/manifest-update.test.ts`
Expected: both new tests FAIL — a negative/fractional load number is currently stored with a 200.

- [ ] **Step 3: Add the server check**

In `src/server/routes/registrations.ts`, directly after the `payment_method` validation (line ~195), insert:

```ts
    // Cleared with null like camera_flyer_id; a load is only ever counted
    // upwards, so a negative number is a typo, not a load.
    if ('load_number' in body && body.load_number !== null &&
        (!Number.isInteger(body.load_number) || body.load_number < 0))
      return reply.code(400).send({ error: 'Load-Nr. ungültig' })
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/manifest-update.test.ts`
Expected: PASS (existing tests use `load_number: 3`, unaffected).

- [ ] **Step 5: Give the manifest input the same floor**

In `web/manifest/src/Detail.tsx` (the Load-Nr. input, line ~341):

```tsx
            <input
              type="number"
              className="numeral"
              min={0}
              value={loadNumber}
              onChange={(e) => setLoadNumber(e.target.value === '' ? '' : Number(e.target.value))}
            />
```

(No client-side error handling beyond this: the server's 400 already surfaces through the Detail screen's existing save-error path.)

- [ ] **Step 6: Run the manifest suite**

Run: `npm --prefix web/manifest test`
Expected: PASS (attribute-only change).

- [ ] **Step 7: Commit**

```bash
git add src/server/routes/registrations.ts tests/manifest-update.test.ts web/manifest/src/Detail.tsx
git commit -m "feat(manifest): negative Load-Nr. wird abgelehnt"
```

---

### Task 5: Toolbar sum "Kassiert:" split into "Kassiert Bar" / "Kassiert Karte"

The list toolbar (`web/manifest/src/List.tsx:396-398`) shows one collected sum. Split it by till using the `collectedVia` rule that already exists server-side (`src/server/pricing.ts:120-125`): a cash/card row counts by its `payment_method`; a voucher row counts by its `voucher_payment_method` (only the top-up moved money). A collected row whose till was never recorded (`collectedVia === null`) appears in neither sum — that money is unaccounted for at closing, and inventing a till for it would hide exactly that.

**Files:**
- Modify: `web/manifest/src/pricing.ts` (append the mirror helper)
- Modify: `web/manifest/src/List.tsx:250,396-398`
- Test: `web/manifest/src/List.test.tsx:230-243`

**Interfaces:**
- Consumes: `Registration.payment_method`, `Registration.voucher_payment_method`, `Registration.paid_at`, `Registration.price` (all already on the API type), `formatEuro` from `web/manifest/src/pricing.ts`.
- Produces: `collectedVia(row: { payment_method?: string | null; voucher_payment_method?: string | null }): 'cash' | 'card' | null` exported from `web/manifest/src/pricing.ts`.

- [ ] **Step 1: Update the existing toolbar-sum test and add the split test**

In `web/manifest/src/List.test.tsx`, replace the test at lines 230–243 (`'sums the day’s takings in the toolbar, split by what is still open'`) with:

```tsx
  it('sums the day’s takings in the toolbar, split by what is still open', async () => {
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, price: 410 }),
      makeRow({ id: 2, price: 100 }),
      // Not manifested yet — must not break the sum.
      makeRow({ id: 3, price: null }),
      makeRow({ id: 4, price: 270, payment_method: 'cash', paid_at: '2026-07-09T12:00:00.000Z' }),
    ])

    renderList()

    expect(await screen.findByText('Offen: 510 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert Bar: 270 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert Karte: 0 €')).toBeInTheDocument()
  })

  it('splits the collected sum by till, counting a voucher row by its top-up', async () => {
    const paid = { paid_at: '2026-07-09T12:00:00.000Z' }
    vi.mocked(api.list).mockResolvedValue([
      makeRow({ id: 1, price: 100, payment_method: 'cash', ...paid }),
      makeRow({ id: 2, price: 200, payment_method: 'card', ...paid }),
      makeRow({ id: 3, price: 50, payment_method: 'voucher', voucher_payment_method: 'cash', ...paid }),
      // Collected, but nobody recorded the till: belongs to neither sum.
      makeRow({ id: 4, price: 30, ...paid }),
      // Still open cash — not collected, not counted.
      makeRow({ id: 5, price: 400, payment_method: 'cash' }),
    ])

    renderList()

    expect(await screen.findByText('Kassiert Bar: 150 €')).toBeInTheDocument()
    expect(screen.getByText('Kassiert Karte: 200 €')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web/manifest test -- List`
Expected: both FAIL (`Unable to find an element with the text: Kassiert Bar: …`).

- [ ] **Step 3: Mirror `collectedVia` into the web pricing module**

Append to `web/manifest/src/pricing.ts` (mirror of `collectedVia` in `src/server/pricing.ts` — same keep-in-sync rule as the rest of this file):

```ts
// Mirror of collectedVia() in src/server/pricing.ts. Which till a row's money
// landed in: a voucher row is only ever cash or card through its top-up, so the
// answer comes from voucher_payment_method there. null means nobody recorded
// it — that money is unaccounted for at closing.
export function collectedVia(
  row: { payment_method?: string | null; voucher_payment_method?: string | null }
): 'cash' | 'card' | null {
  const method = row.payment_method === 'voucher' ? row.voucher_payment_method : row.payment_method
  return method === 'cash' || method === 'card' ? method : null
}
```

- [ ] **Step 4: Split the toolbar sum in List.tsx**

In `web/manifest/src/List.tsx`, extend the pricing import (line 9):

```tsx
import { collectedVia, formatEuro } from './pricing'
```

After the `sumOf` definition (line 250), add:

```tsx
  const paidVia = (via: 'cash' | 'card') =>
    sumOf(paidRows.filter((r) => collectedVia(r) === via))
```

Replace the single collected span (line 398):

```tsx
        <span className="list-total">Kassiert Bar: {formatEuro(paidVia('cash'))}</span>
        <span className="list-total">Kassiert Karte: {formatEuro(paidVia('card'))}</span>
```

(The `Offen:` span at line 397 stays as it is; the two tables and their `Kassiert (n)` caption are untouched.)

- [ ] **Step 5: Run the manifest suite to verify it passes**

Run: `npm --prefix web/manifest test`
Expected: PASS. If any other List test asserted the old `Kassiert: X €` toolbar string, update it to the two new labels the same way as Step 1 — the table caption regexes (`/^Kassiert/` on `getByRole('table')`) are unaffected.

- [ ] **Step 6: Commit**

```bash
git add web/manifest/src/pricing.ts web/manifest/src/List.tsx web/manifest/src/List.test.tsx
git commit -m "feat(manifest): Kassiert-Summe nach Bar und Karte getrennt"
```

---

### Task 6: Full-suite verification

**Files:** none new — verification only.

**Interfaces:** none.

- [ ] **Step 1: Run all three unit suites**

```powershell
npm test; npm --prefix web/guest test; npm --prefix web/manifest test
```

Expected: all PASS.

- [ ] **Step 2: Run the e2e suite**

Run: `npm run test:e2e`
Expected: PASS — `tests/e2e/flow.spec.ts` registers a 182 cm adult and clicks the row button via `getByRole('button', { name: /Kassiert/ })`, both untouched by these changes. If the e2e run flags the renamed toolbar text anywhere, adjust the assertion to `Kassiert Bar`/`Kassiert Karte`.

- [ ] **Step 3: Commit (only if anything was fixed in Step 2)**

```bash
git add -A tests/e2e
git commit -m "test(e2e): Toolbar-Texte nach dem Kassiert-Split"
```
