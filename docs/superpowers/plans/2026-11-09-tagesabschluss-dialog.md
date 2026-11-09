# Tagesabschluss Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline Tagesabschluss warning panel with a modal, four-step guided dialog (Tandems → Kasse → Betriebsleiter → Abschluss) that records a Kassensturz, exports with live progress, and only shows "Fertig" after a successful export.

**Architecture:** Server gets a `day_close` table + `/api/day-close/:date` routes, a Kassensturz block in the sheet, and export guards (BL required, reason required, per-date lock) plus `export-progress` SSE events. The manifest gets a `dayClose/` folder: pure `cashMath.ts`, one component per step, and `DayCloseDialog.tsx` that `List.tsx` mounts instead of the old panel.

**Tech Stack:** Fastify + better-sqlite3 + ExcelJS (server, vitest in `tests/`), React 19 + plain CSS (`web/manifest`, vitest + Testing Library), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-09-tagesabschluss-dialog-design.md`
**Visual reference:** `docs/superpowers/specs/2026-11-09-tagesabschluss-dialog-mockup.html` (approved; port its CSS into `index.css`, its class names may be kept with a `dc-` prefix).

## Global Constraints

- Code, identifiers, comments, logs, commit messages: English. UI text: German, exactly as given in the spec.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01KDV7K6BWA7bJy6KM79zxkZ`
- Colours only from existing `index.css` tokens; amounts in `.numeral`; icons as SVG components like `CheckIcon.tsx` (no Unicode glyphs as icons).
- Manifest target size 1920×1080 and up; light and dark via the existing `prefers-color-scheme` tokens.
- Money is euros as `number` (REAL in SQLite), same as `price`.
- Server test command: `npx vitest run tests/<file>` from repo root. Manifest: `npm --prefix web/manifest test -- <file>` (check `web/manifest/package.json` for the exact script; fall back to `npx vitest run` inside `web/manifest`).

## Review Focus

1. **German amount input** — `1.300,50`, `1300,5`, `1300.50`, `1 300`, `''`, `abc`, `-5`, `1,234`: parse to 1300.5 / 1300.5 / 1300.5 / 1300 / null / invalid / invalid / invalid (more than 2 decimals). Pinned in Task 4.
2. **Expected sums change after counting** — operator counts in step 2, goes back to step 1 and settles a row: difference and "Begründung required" must recompute. Pinned in Task 5.
3. **Double press of "Tagesabschluss durchführen"** — must start one export, not two (second would hit the server's 409 and show an error for the operator's own run). Pinned in Task 6.
4. **SSE echo while settling rows** — the operator's own PATCH triggers a `changed` refresh in `List`; the dialog must keep its step and its typed counts. Pinned in Task 7.
5. **Export with no `day_close` row and no vouchers** (a plain day) — sheet still gets the Kassensturz block with "nicht gezählt", progress goes straight to `sheet`. Pinned in Task 3.

---

### Task 1: `day_close` table and routes

**Files:**
- Modify: `src/server/db.ts` (schema block next to `day_manager`)
- Create: `src/server/routes/dayClose.ts`
- Modify: `src/server/index.ts` (register after `registerDayManagerRoutes`)
- Modify: `web/manifest/src/api.ts` (client functions next to `dayManager`)
- Test: `tests/dayClose.test.ts`

**Interfaces:**
- Produces (server): `registerDayCloseRoutes(app: FastifyInstance, db: Database): void`; `readDayClose(db: Database, date: string): { countedCash: number | null; countedCard: number | null; note: string }` exported from `routes/dayClose.ts` (Task 3 uses it).
- Produces (client, `api.ts`):
  ```ts
  export interface DayCloseDraft { countedCash: number | null; countedCard: number | null; note: string }
  export interface DayCloseState extends DayCloseDraft { exportedAt: string | null }
  export async function dayClose(date: string): Promise<DayCloseState>
  export async function saveDayClose(date: string, draft: DayCloseDraft): Promise<DayCloseState>
  ```

- [ ] **Step 1: Write failing tests** in `tests/dayClose.test.ts` using `testServer()`:
  - `GET /api/day-close/2026-07-09` on an empty db → 200 `{ countedCash: null, countedCard: null, note: '', exportedAt: null }`
  - `PUT` `{ countedCash: 1300, countedCard: 548.5, note: '  Trinkgeld  ' }` → 200 echoes `{ countedCash: 1300, countedCard: 548.5, note: 'Trinkgeld', exportedAt: null }`; a following GET returns the same
  - `PUT` with `countedCash: null` stores null (nicht gezählt)
  - each day keeps its own values (PUT on 07-09 and 07-10, GET both)
  - `exportedAt` is the `day_exports.exported_at` of that date (insert a row directly)
  - 400 for: date `2026-7-9`; `countedCash: -1`; `countedCash: 1.005`; `countedCash: 'x'`; `countedCard: Infinity` (send as `1e309` in raw JSON → treat non-finite as invalid); `note` of 501 chars; `note` missing (not a string)
- [ ] **Step 2: Run** `npx vitest run tests/dayClose.test.ts` → FAIL (404s).
- [ ] **Step 3: Implement.** Schema exactly as in the spec (`day_close`). Routes mirror `dayManager.ts` style (`DATE` regex, `{ error: 'Datum ungültig' }`). Amount rule: `null` or finite number ≥ 0 with `Math.round(v * 100) === v * 100` (use `Math.abs(v*100 - Math.round(v*100)) < 1e-9`). Errors: `'Betrag ungültig'`, `'Begründung zu lang'`, `'Begründung fehlt'`. Note is trimmed. Upsert with `updated_at = new Date().toISOString()`. Client functions follow `dayManager`/`saveDayManager` (`errorMessage` fallbacks `'Kassensturz konnte nicht geladen werden'` / `'Kassensturz speichern fehlgeschlagen'`).
- [ ] **Step 4: Run** the test file → PASS; run `npx vitest run tests/db.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(server): store the Kassensturz per day`.

### Task 2: Kassensturz block in the sheet

**Files:**
- Modify: `src/server/excel.ts`
- Test: `tests/excel.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CashCount {
    expectedCash: number; expectedCard: number
    countedCash: number | null; countedCard: number | null
    note: string
  }
  buildWorkbook(rows, columns, meta, totals, payouts, cashCount?: CashCount): Promise<Buffer>
  ```
  The block is written right after the totals block and before the payout sections, preceded by one blank row.

- [ ] **Step 1: Write failing tests** in `tests/excel.test.ts` (read the buffer back with ExcelJS, find the row whose cell 1 is `'Kassensturz'`, then assert following rows):
  - counted 1300 / expected 1295, counted 548 / expected 548, note `'Trinkgeld in der Kasse'` → rows `['Kassensturz']`, `['Gezählt Bar', 1300]`, `['Differenz Bar', 5]`, `['Gezählt Karte', 548]`, `['Differenz Karte', 0]`, `['Begründung', 'Trinkgeld in der Kasse']`; amount cells carry `EURO_FORMAT`; `Differenz` cells use a signed format (`'+#,##0.00 €;-#,##0.00 €;0,00 €'` or equivalent) — assert the numFmt starts with `+`.
  - countedCash null → `['Gezählt Bar', 'nicht gezählt']` and no `'Differenz Bar'` row
  - empty note → no `'Begründung'` row
  - `cashCount` omitted → no `'Kassensturz'` row at all (existing callers unchanged)
- [ ] **Step 2: Run** `npx vitest run tests/excel.test.ts` → new tests FAIL.
- [ ] **Step 3: Implement** the optional parameter; labels bold like the totals.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(export): write the Kassensturz block into the day sheet`.

### Task 3: Export guards, lock, progress, Kassensturz wiring

**Files:**
- Modify: `src/server/routes/export.ts`
- Modify: `src/server/index.ts` (pass `sse`)
- Modify: `web/manifest/src/api.ts` (`exportDay`)
- Modify: `web/manifest/src/useEvents.ts`
- Test: `tests/export.test.ts`, `web/manifest/src/useEvents.test.ts`

**Interfaces:**
- Consumes: `readDayClose` (Task 1), `CashCount` + `buildWorkbook(..., cashCount)` (Task 2).
- Produces (server): `registerExportRoutes(app, db, cfgRef, sse?: SseHub)`; event `export-progress` with data
  `{ run: string; date: string; phase: 'vouchers'; done: number; total: number } | { run: string; date: string; phase: 'sheet' }`.
- Produces (client):
  ```ts
  export type ExportProgress =
    | { run: string; date: string; phase: 'vouchers'; done: number; total: number }
    | { run: string; date: string; phase: 'sheet' }
  export async function exportDay(date: string, runId?: string): Promise<ExportResult>   // adds &run=
  export function useExportProgress(runId: string | null, onProgress: (p: ExportProgress) => void): void
  ```

- [ ] **Step 1: Update existing tests first.** In `tests/export.test.ts`, make `seed()` also insert `day_manager (date, 'Max Muster')`; give every test that does not use `seed()` a BL the same way. Rename `'... meta rows, BL left blank'` to assert a **400 `{ error: 'Betriebsleiter fehlt' }`** when no BL exists and that no file is written.
- [ ] **Step 2: Write failing tests** in `tests/export.test.ts`:
  - no BL → 400 `'Betriebsleiter fehlt'`, no `day_exports` row
  - `day_close` with countedCash ≠ Summe Bar and note `''` → 400 `'Begründung für die Kassendifferenz fehlt'`; same with note `'x'` → 200
  - differing count with **countedCash null** and countedCard equal → 200 (uncounted never needs a reason)
  - sheet contains the Kassensturz block computed from `day_close` and the Summe Bar / Summe Karte of the same export; no `day_close` row → both `'nicht gezählt'`
  - lock: start two `app.inject` POSTs for the same date concurrently while `redeemVoucher` is slowed (use a voucher list file + a voucher row; or `vi.spyOn` on `../src/server/voucherRedeem` to return a promise you resolve manually) → one 200, one 409 `'Tagesabschluss läuft bereits'`; afterwards a third POST → 200 (lock released, also after a thrown error)
  - progress: pass a fake `{ broadcast: vi.fn() }` as `sse`, POST with `&run=abc` on a day with 2 owed vouchers → calls in order `('export-progress', {run:'abc', date, phase:'vouchers', done:0, total:2})`, `done:1`, `done:2`, then `{run:'abc', date, phase:'sheet'}`; without `run` → no broadcast
  - plain day (no vouchers, no `day_close`) with `run` → `vouchers 0/0` then `sheet`, 200, block says `'nicht gezählt'` (Review Focus 5)
  - `run` longer than 64 chars or with characters outside `[A-Za-z0-9-]` → 400 `'Lauf-Kennung ungültig'`
- [ ] **Step 3: Run** `npx vitest run tests/export.test.ts` → new tests FAIL.
- [ ] **Step 4: Implement.** Order inside the handler: validate date and run → BL check → compute totals → reason check (`countedX !== null && Math.abs(countedX - expectedX) >= 0.005`) → acquire lock (module-level `Set<string>` inside `registerExportRoutes`; 409 if present) → `try { vouchers (+progress) → 'sheet' progress → build + write + day_exports } finally { release }`. Pass `CashCount` into `buildWorkbook`. In `index.ts`: `registerExportRoutes(app, db, cfgRef, sse)`.
- [ ] **Step 5: Run** → PASS. Run full server suite `npx vitest run tests` → PASS.
- [ ] **Step 6: Client.** Write a failing test in `useEvents.test.ts`: `useExportProgress('abc', cb)` calls `cb` for a fired `export-progress` frame with `run: 'abc'`, ignores `run: 'other'`, opens no EventSource when `runId` is null (use `fireRawEvent` / `eventSourceOpenCount` from `setupTests`). Implement hook like `useUpdateEvents`. Extend `exportDay`. Run manifest tests for that file → PASS.
- [ ] **Step 7: Commit** `feat(export): require BL and reason, lock per day, report progress`.

### Task 4: `cashMath.ts`

**Files:**
- Create: `web/manifest/src/dayClose/cashMath.ts`
- Test: `web/manifest/src/dayClose/cashMath.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface TandemGroups { open: Registration[]; noMethod: Registration[]; freeVoucher: Registration[] }
  export function groupTandems(rows: Registration[]): TandemGroups
  export function expectedTills(rows: Registration[]): { cash: number; card: number }
  export function parseAmount(input: string): number | null | 'invalid'
  export function formatAmountInput(value: number | null): string            // 1300 → '1.300,00', null → ''
  export function difference(counted: number | null, expected: number): number | null   // rounded to cents
  export function needsReason(counted: { cash: number | null; card: number | null }, expected: { cash: number; card: number }): boolean
  export function openCount(rows: Registration[]): number                    // paid_at == null, any price
  ```
  Group rules exactly as spec §1 (open: `paid_at == null && price > 0`; noMethod: `paid_at != null && collectedVia == null && price > 0`; freeVoucher: `paid_at == null && (price ?? 0) <= 0`). `expectedTills` = sum of `price` over `paid_at != null` grouped by `collectedVia` (import from `../pricing`).

- [ ] **Step 1: Failing tests:** each group rule incl. a voucher top-up row (`payment_method:'voucher'`, `voucher_payment_method:'card'`, paid) counting into card; Review Focus 1 table for `parseAmount`; `difference(1300, 1295) === 5`, `difference(0.1+0.2, 0.3) === 0`, `difference(null, 5) === null`; `needsReason` true only when a counted till differs by ≥ 0.005.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(manifest): Kassensturz arithmetic for the closing dialog`.

### Task 5: Dialog shell and the four steps (no export yet)

**Files:**
- Create: `web/manifest/src/dayClose/DayCloseDialog.tsx`, `StepTandems.tsx`, `StepCash.tsx`, `StepManager.tsx`, `StepSummary.tsx`, `AlertIcon.tsx` (the "!" marker, drawn like `CheckIcon`)
- Modify: `web/manifest/src/index.css` (new section `/* Tagesabschluss dialog */`, ported from the mockup)
- Test: `web/manifest/src/dayClose/DayCloseDialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 client API, Task 4 functions.
- Produces:
  ```ts
  export interface DayCloseDialogProps {
    date: string
    rows: Registration[]                       // live from List
    masterNames: Map<number, string>
    manager: string
    onManagerChange: (name: string) => void
    saveManager: () => Promise<boolean>        // List's existing saveManager
    settleRow: (row: Registration, method: CollectedVia | null) => Promise<void>  // throws on failure
    onClose: () => void
  }
  export default function DayCloseDialog(props: DayCloseDialogProps): JSX.Element
  type StepId = 'tandems' | 'cash' | 'manager' | 'summary'
  ```
  Mount-only `showModal()` like `CollectDialog`. Rail entries are `<button>`s, enabled only for steps with index < furthest-visited and only while not running; current one has `aria-current="step"`. Copy (titles, ledes, labels, button texts, status lines, "Alles erledigt", "Name fehlt", "nötig, weil Bar abweicht" / "Karte" / "Bar und Karte abweichen") exactly per spec and mockup.

- [ ] **Step 1: Failing tests** (mock `../api` with `dayClose`, `saveDayClose`):
  - opens on step Tandems; rail shows 4 steps; Zurück absent on step 1
  - Tandems groups render with counts; Bar on an open row calls `settleRow(row, 'cash')`; Kassieren on a 0 € voucher calls `settleRow(row, null)`; a rejected `settleRow` shows its message on that row
  - no rows needing work → "Alles erledigt"
  - Weiter with open rows left → Kasse, Tandems rail item shows the warning marker and "1 bleibt offen"
  - Kasse: expected values from rows; typing `1.300,00` with expected 1.295 shows `+5,00 €` and "zu viel", reveals required Begründung; Weiter disabled until it has text; invalid input shows "Betrag ungültig" and blocks Weiter; empty fields allowed
  - `dayClose()` rejects → fields empty, Kasse shows "Kassensturz konnte nicht geladen werden", dialog still usable
  - draft loaded from `dayClose()` pre-fills the fields; `saveDayClose` called on field blur and on leaving the step with the parsed values
  - `exportedAt` set → strip "Bereits abgeschlossen am 8.11., 18:42 · erneut abschließen überschreibt das Blatt. Die Werte von damals sind eingesetzt." (format date `d.M.`, time `HH:mm`, local)
  - Betriebsleiter: Weiter disabled while blank with "Name fehlt"; typing calls `onManagerChange`; Weiter calls `saveManager()` and stays on the step when it returns false
  - Summary shows BL, counts, Bar/Karte lines, Begründung, leftover box with "Zu Tandems" that jumps to step 1
  - rail: clicking an earlier step navigates; a later, unvisited step is disabled
  - **Review Focus 2:** count Bar equal to expected, go back, settle an open row by Bar (rerender with updated `rows`), go to Kasse → difference now negative and Begründung required
  - Abbrechen and Esc (`cancel` event) call `saveDayClose` with the current draft, then `onClose`
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** components + CSS (rail, markers, ledger, money fields, summary, leftover box, allclear, reduced-motion rule, themed scrollbar, `[hidden]` handling). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(manifest): guided Tagesabschluss dialog steps`.

### Task 6: Running the export, Fertig, failure

**Files:**
- Create: `web/manifest/src/dayClose/ExportRunning.tsx`, `ExportDone.tsx`
- Modify: `DayCloseDialog.tsx`, `StepSummary.tsx`, `index.css`
- Test: `DayCloseDialog.test.tsx`

**Interfaces:**
- Consumes: `exportDay(date, runId)`, `useExportProgress`, `ExportResult` (existing `{ path, count, redemptionsWritten, redemptionsPending, redemptionsInvalid }`).
- Run id: `crypto.randomUUID()` (fallback `Date.now().toString(36) + Math.random().toString(36).slice(2)` when unavailable).

- [ ] **Step 1: Failing tests:**
  - "Tagesabschluss durchführen": calls `saveDayClose` first, then `exportDay(date, runId)`; while pending: phases shown ("Kassensturz gespeichert" ✓, "Gutscheinliste", "Excel-Blatt"), "Bitte warten, nicht schließen. Das dauert ein paar Sekunden.", Zurück/Abbrechen/✕/rail disabled, `cancel` event prevented (onClose not called)
  - a fired progress frame for this run shows "2 von 3"; a frame for another run changes nothing
  - **Review Focus 3:** two quick clicks → `exportDay` called once
  - resolve → Fertig: "Tag abgeschlossen", path, "3 eingetragen" (+ "N noch offen", "N ungültig" when > 0), Kassensturz line, open-left line; only button "Schließen" → `onClose`
  - `saveDayClose` rejects → no export, summary shows its message
  - `exportDay` rejects with `'Tagesabschluss läuft bereits'` → the box reads "Tagesabschluss läuft bereits (anderer Rechner)"
  - `exportDay` rejects with any error → summary with red box "Tagesabschluss fehlgeschlagen", message, "Der Tag ist noch nicht abgeschlossen.", button "Erneut versuchen", rail status "Fehlgeschlagen"; Erneut versuchen runs again
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (spinner + progress bar + seal from mockup). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(manifest): live export progress and result in the closing dialog`.

### Task 7: Wire into `List.tsx`, remove the old panel

**Files:**
- Modify: `web/manifest/src/List.tsx`, `web/manifest/src/index.css`
- Test: `web/manifest/src/List.test.tsx`

**Interfaces:**
- Consumes: `DayCloseDialog` props (Task 5).
- `settleRow(row, method)` in List: PATCH `{ paid: true }` plus method using the exact `runCollect` field rule (voucher → `voucher_payment_method`, else `payment_method`; only when `price > 0` and method non-null; for an already-paid row send only the method fields). Fold the answer in with functional `setRows`. Throw on failure.

- [ ] **Step 1: Replace tests.** Delete the `describe('Export-Warnung')` block and any test asserting the old panel or "Trotzdem exportieren"/"Alle kassieren und exportieren". Add `dayClose`/`saveDayClose` to the `vi.mock('./api')` list. New tests:
  - "Tagesabschluss" opens a dialog named "Tagesabschluss" (no export call yet)
  - settling an open row by Bar inside the dialog PATCHes `{ paid: true, payment_method: 'cash' }` and the row moves to the Kassiert table
  - settling a voucher top-up row by Karte PATCHes `voucher_payment_method: 'card'`
  - **Review Focus 4:** in the dialog, type a counted amount on Kasse, then `fireChangedEvent()` → still on Kasse, value kept
  - the toolbar BL field and the dialog BL field show the same value
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**: state `closingOpen: boolean`; the button opens it (label stays "Tagesabschluss", disabled while `collecting`). Remove exactly the items listed in spec §Komponenten (`ExportWarning`, `warningCounts`, `warningExplanation`, `computeExportWarning`, `handleCollectAllAndExport`, `runExport`, `exportMessage`, `exporting`, `needs-entry`, `managerInput` if unused) and their CSS rules. After `onClose`, call `refresh()`.
- [ ] **Step 4: Run** the whole manifest suite → PASS; `npm --prefix web/manifest run build` (tsc + vite) → no errors; run oxlint if configured (`npx oxlint web/manifest/src`).
- [ ] **Step 5: Commit** `feat(manifest): open the guided dialog from Tagesabschluss`.

### Task 8: E2E, design check, exe

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

- [ ] **Step 1: Update e2e** (from the "Export the day" comment): click "Tagesabschluss" → in the dialog Weiter (Tandems) → fill "Gezählt Bar" with the row's price if it was collected cash, else leave empty → Weiter → fill Betriebsleiter "Max Muster" → Weiter → wait for the POST `/api/export` response while clicking "Tagesabschluss durchführen" → expect "Tag abgeschlossen" → keep the existing xlsx assertions, plus assert the `Kassensturz` row exists.
- [ ] **Step 2: Run** `npm run test:e2e` → PASS (builds as its config says; read `playwright.config.*` for prerequisites).
- [ ] **Step 3: Design check.** Run `"C:/Users/Markus/.claude/plugins/cache/impeccable/impeccable/4.6.0/skills/impeccable/scripts/impeccable" detect --json web/manifest/src/dayClose web/manifest/src/index.css`; fix real findings. Screenshot the running dialog at 1920×1080 light and dark (headless Edge `--screenshot` against the dev server or built app) and compare with the mockup.
- [ ] **Step 4: Full verification:** `npm test` (root) and manifest suite → PASS.
- [ ] **Step 5: Commit** `test(e2e): close the day through the guided dialog`.
- [ ] **Step 6: Build the exe:** `npm run build:all` → `tandem.exe` (and `better_sqlite3.node`) in the output folder that `scripts/build-exe.mjs` names; report the path and size. No version bump, no tag, no release.
