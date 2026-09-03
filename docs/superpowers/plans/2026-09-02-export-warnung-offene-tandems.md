# Export-Warnung bei offenen Tandems Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the operator presses *Exportieren* on a day that still has uncollected tandems, or tandems without a Zahlungsart, show a warning panel that explains what the export would leave out and offers to collect everything first.

**Architecture:** Entirely client-side, in `web/manifest/src/List.tsx`. That component already holds the day's rows, so both counts are derived from state it has. The *Exportieren* click is split: `handleExport()` decides whether to warn, `runExport()` does what the handler does today. "Alle kassieren" loops the existing `patch(id, { paid: true })` — the same call the row's own ✓ Kassiert button makes — because that PATCH handler (`src/server/routes/registrations.ts:316`) is where a voucher row's redemption gets stamped for the export sweep. No server change, no new endpoint.

**Tech Stack:** React 19, TypeScript, Vitest + @testing-library/react (`web/manifest`), Playwright for e2e (repo root).

## Background: why this warning is worth showing

Two separate facts about a day can make an export misleading, and neither is visible from the export button:

1. **Uncollected tandems.** A voucher row is written into the club's Gutscheinliste only once it has been collected. Collecting is what sets `voucher_redeemed_at` (`src/server/routes/registrations.ts:316`), and the export sweep writes exactly the rows that carry it (`src/server/routes/export.ts:79`). An open voucher tandem therefore never reaches the club's list — silently.
2. **Missing Zahlungsart.** The export already has a `Summe ohne Zahlungsart` total line (`src/server/routes/export.ts:50`) for money nobody assigned to a till. It is easy to miss at the bottom of a sheet.

The panel says both, in German, before the sheet is written.

## Global Constraints

- All user-facing text is German. Singular and plural are both written out — the codebase already does this for the redemption banner (`List.tsx:378`), and "1 Einlösungen" reads as a different number than "1 Einlösung".
- Comments explain *why*, not *what*, matching the surrounding file. Do not add narration comments.
- The predicate for "no Zahlungsart" must be `collectedVia(r) === null && (r.price ?? 0) > 0`, using the existing `collectedVia` from `./pricing`. It mirrors the export's own total so the warning and the sheet cannot disagree; the price guard exists because a fully covered voucher moves no money, needs no Zahlungsart, and contributes 0 € to that total — counting it would send the operator hunting for a field that must stay empty.
- The toolbar button keeps the exact accessible name `Exportieren`. Existing tests select it with `getByRole('button', { name: 'Exportieren' })` (exact string), and the panel's button is named `Trotzdem exportieren`, so the two never collide.
- Run all commands from the repo root: `C:\Users\Markus\Documents\Git Projects\Tandem-Registration`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `web/manifest/src/List.tsx` | Modify | The whole feature: counts, decision, panel, bulk collect |
| `web/manifest/src/List.test.tsx` | Modify | Tests for all of the above |
| `web/manifest/src/index.css` | Modify | `.export-warning` panel styling |

No new files. The feature is ~70 lines in a component that already owns the day, its rows and its export button; a separate component would need every one of those passed to it.

---

### Task 1: Warn before exporting, and let the operator proceed or cancel

**Files:**
- Modify: `web/manifest/src/List.tsx` (state near line 157, derived rows near line 275, `handleExport` at lines 322-353, JSX after the toolbar at line 469)
- Test: `web/manifest/src/List.test.tsx`

**Interfaces:**
- Consumes: `collectedVia` (already imported from `./pricing` at `List.tsx:9`), `exportDay` (already imported at `List.tsx:3`), the existing `openRows` / `rows` state.
- Produces: `interface ExportWarning { open: number; openVoucher: number; noPayment: number }`, the module-level helpers `warningCounts(w: ExportWarning): string` and `warningExplanation(w: ExportWarning): string`, the component-scope functions `runExport(): Promise<void>` and `handleExport(): void`, and the state setter `setExportWarning`. Task 2 calls `runExport()` and reads `exportWarning`.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block to `web/manifest/src/List.test.tsx`, immediately before the closing `})` of the outer `describe('List', ...)` block (the last line of the file).

```tsx
  // Two things about a day can make an export misleading, and neither is
  // visible from the button: a tandem that is not collected never reaches the
  // club's Gutscheinliste, and one without a Zahlungsart lands in the sheet's
  // "Summe ohne Zahlungsart" line. The panel says so before the sheet is
  // written.
  describe('Export-Warnung', () => {
    const exportButton = () => screen.getByRole('button', { name: 'Exportieren' })

    beforeEach(() => {
      vi.clearAllMocks()
      vi.mocked(api.masters).mockResolvedValue([])
      vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })
      vi.mocked(api.dayTables).mockResolvedValue({
        prices: PRICES, payouts: PAYOUTS, frozen: true,
        current: { prices: PRICES, payouts: PAYOUTS },
      })
      vi.mocked(api.dayManager).mockResolvedValue({ name: '' })
      vi.mocked(api.saveDayManager).mockImplementation(async (_d, name) => ({ name: name.trim() }))
      vi.mocked(api.exportDay).mockResolvedValue({
        path: 'C:/export/Tandem_2026-07-09.xlsx', count: 1,
        redemptionsWritten: 0, redemptionsPending: 0, redemptionsInvalid: 0,
      })
    })

    it('exports straight away when the day is collected and paid for', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'cash', price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument()
    })

    it('warns instead of exporting while tandems are still open', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
        makeRow({ id: 2, payment_method: 'card', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/2 Tandems sind noch nicht kassiert\./))
        .toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    // The voucher count is the point of the whole panel: those are the rows the
    // club's list silently never hears about.
    it('names how many of the open tandems are on a voucher', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
        makeRow({
          id: 2, payment_method: 'voucher', voucher_payment_method: 'cash',
          voucher_number: 'G-1', price: 30,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(
        /2 Tandems sind noch nicht kassiert, davon 1 mit Gutschein\./
      )).toBeInTheDocument()
      expect(screen.getByText(/Nur kassierte Tandems mit Gutschein/)).toBeInTheDocument()
    })

    it('gets the singular right for a single open tandem', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/^1 Tandem ist noch nicht kassiert\./))
        .toBeInTheDocument()
    })

    // A collected row without a Zahlungsart is exactly what the sheet's
    // "Summe ohne Zahlungsart" line flags, so it is worth catching while it can
    // still be fixed.
    it('counts a collected tandem that has no Zahlungsart', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: null, price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/1 Tandem hat keine Zahlungsart\./)).toBeInTheDocument()
      expect(screen.getByText(/Summe ohne Zahlungsart/)).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    // Nothing was paid, so there is no till the row could be missing from. The
    // export's own total ignores it for the same reason.
    it('leaves a fully covered voucher alone', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: 'voucher',
          voucher_payment_method: null, voucher_number: 'G-1', price: 0,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(screen.queryByText(/keine Zahlungsart/)).not.toBeInTheDocument()
    })

    it('exports anyway when the operator says so', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(await screen.findByRole('button', { name: 'Trotzdem exportieren' }))

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(api.exportDay).toHaveBeenCalledWith('2026-07-09')
      expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument()
    })

    it('writes nothing when the operator cancels', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(await screen.findByRole('button', { name: 'Abbrechen' }))

      await waitFor(() =>
        expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument())
      expect(api.exportDay).not.toHaveBeenCalled()
      expect(api.saveDayManager).not.toHaveBeenCalled()
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm --prefix web/manifest run test -- List.test.tsx -t "Export-Warnung"
```

Expected: FAIL. `warns instead of exporting while tandems are still open` fails because `exportDay` *was* called; the button lookups for `Trotzdem exportieren` and `Abbrechen` fail with "Unable to find an accessible element with the role button".

- [ ] **Step 3: Add the warning type and its two text helpers**

In `web/manifest/src/List.tsx`, insert this directly above `export default function List(` (currently line 148, right after the `RegistrationTable` component ends):

```tsx
/**
 * What one press of Exportieren found wrong with the day. Counted at the moment
 * of the press and held, so the panel keeps saying what the operator was asked
 * about even if another tablet adds a row while it stands.
 */
interface ExportWarning {
  open: number
  openVoucher: number
  noPayment: number
}

/** The panel's first line: what the day still has open, in words. */
function warningCounts(w: ExportWarning): string {
  const parts: string[] = []
  if (w.open > 0) {
    const open = w.open === 1
      ? '1 Tandem ist noch nicht kassiert'
      : `${w.open} Tandems sind noch nicht kassiert`
    const voucher = w.openVoucher === 0
      ? ''
      : w.openVoucher === 1
        ? ', davon 1 mit Gutschein'
        : `, davon ${w.openVoucher} mit Gutschein`
    parts.push(`${open}${voucher}.`)
  }
  if (w.noPayment > 0) {
    parts.push(w.noPayment === 1
      ? '1 Tandem hat keine Zahlungsart.'
      : `${w.noPayment} Tandems haben keine Zahlungsart.`)
  }
  return parts.join(' ')
}

/**
 * Why those counts matter, in terms of the two files the export writes. The
 * "nachgetragen" promise is not reassurance: the export's redemption sweep is
 * deliberately not scoped to the exported date, so a later export does pick up
 * whatever was collected in the meantime.
 */
function warningExplanation(w: ExportWarning): string {
  const parts: string[] = []
  if (w.open > 0) {
    parts.push('Nur kassierte Tandems mit Gutschein werden in die Gutscheinliste ' +
      'eingetragen. Offene bleiben stehen und werden beim nächsten Export nachgetragen.')
  }
  if (w.noPayment > 0) {
    parts.push('Tandems ohne Zahlungsart zählt der Export unter „Summe ohne Zahlungsart“.')
  }
  return parts.join(' ')
}
```

- [ ] **Step 4: Add the state**

In `web/manifest/src/List.tsx`, find these two lines (currently 157-158):

```tsx
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
```

Replace with:

```tsx
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  // Set by Exportieren when the day is not ready to be written; null while there
  // is nothing to ask about.
  const [exportWarning, setExportWarning] = useState<ExportWarning | null>(null)
```

- [ ] **Step 5: Derive the two counts**

Find these lines (currently 271-275):

```tsx
  const openRows = sortedRows.filter((r) => r.paid_at == null)
  const paidRows = sortedRows.filter((r) => r.paid_at != null)
```

Insert after them:

```tsx
  // A voucher row reaches the club's Gutscheinliste only once it is collected —
  // collecting is what stamps voucher_redeemed_at (see routes/registrations.ts),
  // and the export sweep writes exactly the rows that carry it. So an open one
  // misses the list without saying a word.
  const openVoucherRows = openRows.filter((r) => r.payment_method === 'voucher')
  // The predicate the export's "Summe ohne Zahlungsart" line uses, so the
  // warning and the sheet cannot disagree — collected rows included, because a
  // collected row without a method is exactly what that line flags. The price
  // guard is there because a fully covered voucher moves no money and needs no
  // method: it adds 0 € to that line, so counting it here would send the
  // operator hunting for a field that has to stay empty.
  const noPaymentRows = rows.filter((r) => collectedVia(r) === null && (r.price ?? 0) > 0)
```

- [ ] **Step 6: Split the export handler**

Find the whole `handleExport` function (currently lines 322-353, from `async function handleExport() {` down to its closing `}`) and replace it with:

```tsx
  async function runExport() {
    setExportWarning(null)
    setExportMessage(null)
    // Clicking the button blurs the field, but the blur save is only started —
    // the sheet has to carry what stands in the field, not the name from before
    // the last keystroke. A failed save stops the export rather than writing a
    // sheet with the wrong Betriebsleiter on it.
    if (!(await saveManager())) return
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

  // Nothing is written until the operator has seen what the day is missing.
  // That includes the Betriebsleiter save inside runExport: a press that ends in
  // Abbrechen must leave the day exactly as it was.
  function handleExport() {
    if (openRows.length === 0 && noPaymentRows.length === 0) {
      void runExport()
      return
    }
    setExportMessage(null)
    setExportWarning({
      open: openRows.length,
      openVoucher: openVoucherRows.length,
      noPayment: noPaymentRows.length,
    })
  }
```

- [ ] **Step 7: Render the panel**

Find the end of the toolbar and the line after it (currently lines 469-471):

```tsx
      </div>

      {exportMessage && <p className="hint">{exportMessage}</p>}
```

Replace with:

```tsx
      </div>

      {exportWarning && (
        <div className="export-warning">
          <p>{warningCounts(exportWarning)}</p>
          <p>{warningExplanation(exportWarning)}</p>
          <div className="export-warning-actions">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => { void runExport() }}
              disabled={exporting}
            >
              Trotzdem exportieren
            </button>
            <button
              type="button"
              className="btn secondary small"
              onClick={() => setExportWarning(null)}
              disabled={exporting}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {exportMessage && <p className="hint">{exportMessage}</p>}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npm --prefix web/manifest run test -- List.test.tsx -t "Export-Warnung"
```

Expected: PASS, 8 tests.

- [ ] **Step 9: Run the whole manifest suite**

```bash
npm --prefix web/manifest run test
```

Expected: PASS. The pre-existing export tests all mock `api.list` to `[]`, so an empty day still exports without a panel — if any of them now fail, the guard in `handleExport` is wrong, not the test.

- [ ] **Step 10: Commit**

```bash
git add web/manifest/src/List.tsx web/manifest/src/List.test.tsx
git commit -m "feat(export): Warnung vor Export bei offenen Tandems und fehlender Zahlungsart

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015hDbRGs5uMPUfVQXRQBhgc"
```

---

### Task 2: Collect everything, then export

**Files:**
- Modify: `web/manifest/src/List.tsx` (new handler after `runExport`, one more button in the panel)
- Test: `web/manifest/src/List.test.tsx`

**Interfaces:**
- Consumes: `runExport()`, `exportWarning`, `openRows`, `refresh()` from Task 1 and the existing component; `patch` (already imported at `List.tsx:4`).
- Produces: `handleCollectAllAndExport(): Promise<void>` and the `collecting` state flag. Nothing later depends on them.

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe('Export-Warnung', ...)` block created in Task 1, before its closing `})`.

```tsx
    // The loop goes through the same PATCH as a row's own ✓ Kassiert button.
    // That handler is where a voucher row's redemption is queued for the export
    // sweep, so a bulk route of its own would have to repeat that rule to stay
    // correct.
    it('collects every open tandem and then exports', async () => {
      const user = userEvent.setup()
      const a = makeRow({ id: 1, first_name: 'Anna', payment_method: 'cash', price: 270 })
      const b = makeRow({ id: 2, first_name: 'Bruno', payment_method: 'card', price: 270 })
      vi.mocked(api.list).mockResolvedValue([a, b])
      const calls: string[] = []
      vi.mocked(api.patch).mockImplementation(async (id) => {
        calls.push(`patch:${id}`)
        return { ...(id === 1 ? a : b), paid_at: '2026-07-09T12:00:00.000Z' }
      })
      vi.mocked(api.exportDay).mockImplementation(async () => {
        calls.push('export')
        return {
          path: 'C:/export/Tandem_2026-07-09.xlsx', count: 2,
          redemptionsWritten: 0, redemptionsPending: 0, redemptionsInvalid: 0,
        }
      })
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      expect(await screen.findByText(/Export erstellt/)).toBeInTheDocument()
      expect(api.patch).toHaveBeenCalledWith(1, { paid: true })
      expect(api.patch).toHaveBeenCalledWith(2, { paid: true })
      expect(calls).toEqual(['patch:1', 'patch:2', 'export'])
    })

    // A half-collected day must not reach the club's sheet: it would look
    // finished while some of the money still shows as outstanding.
    it('does not export when one of the rows could not be collected', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      vi.mocked(api.patch).mockRejectedValue(new Error('Speichern fehlgeschlagen'))
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      await user.click(
        await screen.findByRole('button', { name: 'Alle kassieren und exportieren' }))

      expect(await screen.findByText('Speichern fehlgeschlagen')).toBeInTheDocument()
      expect(api.exportDay).not.toHaveBeenCalled()
    })

    // Nothing is open, so there is nothing to collect — offering the button
    // would promise an action that does nothing.
    it('offers no bulk collect when only the Zahlungsart is missing', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({
          id: 1, paid_at: '2026-07-09T12:00:00.000Z', payment_method: null, price: 270,
        }),
      ])
      renderList({ date: '2026-07-09' })
      await screen.findByText('Anna Muster')

      await user.click(exportButton())

      expect(await screen.findByText(/keine Zahlungsart/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Alle kassieren und exportieren' }))
        .not.toBeInTheDocument()
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm --prefix web/manifest run test -- List.test.tsx -t "Export-Warnung"
```

Expected: FAIL on the first two with "Unable to find an accessible element with the role \"button\" and name \"Alle kassieren und exportieren\"".

- [ ] **Step 3: Add the state flag**

In `web/manifest/src/List.tsx`, find the line added in Task 1:

```tsx
  const [exportWarning, setExportWarning] = useState<ExportWarning | null>(null)
```

Replace with:

```tsx
  const [exportWarning, setExportWarning] = useState<ExportWarning | null>(null)
  const [collecting, setCollecting] = useState(false)
```

- [ ] **Step 4: Add the handler**

In `web/manifest/src/List.tsx`, insert this directly after the `handleExport` function added in Task 1:

```tsx
  // Collects every still-open row through the row button's own PATCH, then
  // exports. Sequential on purpose: the rows are few, and a failure has to stop
  // the run rather than leave the rest in flight.
  async function handleCollectAllAndExport() {
    setCollecting(true)
    setError(null)
    try {
      for (const row of openRows) {
        await patch(row.id, { paid: true })
      }
    } catch (err) {
      // A half-collected day must not reach the club's sheet — it would look
      // finished while some of the money is still shown as outstanding.
      setError(err instanceof Error ? err.message : 'Kassieren fehlgeschlagen')
      return
    } finally {
      setCollecting(false)
    }
    await runExport()
    // The rows were collected on the server; this is what moves them into the
    // Kassiert table on screen.
    refresh()
  }
```

- [ ] **Step 5: Add the button**

In `web/manifest/src/List.tsx`, find the actions block added in Task 1:

```tsx
          <div className="export-warning-actions">
            <button
              type="button"
              className="btn secondary small"
              onClick={() => { void runExport() }}
              disabled={exporting}
            >
              Trotzdem exportieren
            </button>
```

Replace with:

```tsx
          <div className="export-warning-actions">
            {/* Only when there is something to collect — a button that would do
                nothing promises an action the day does not have. */}
            {exportWarning.open > 0 && (
              <button
                type="button"
                className="btn small"
                onClick={() => { void handleCollectAllAndExport() }}
                disabled={collecting || exporting}
              >
                {collecting ? 'Wird kassiert…' : 'Alle kassieren und exportieren'}
              </button>
            )}
            <button
              type="button"
              className="btn secondary small"
              onClick={() => { void runExport() }}
              disabled={collecting || exporting}
            >
              Trotzdem exportieren
            </button>
```

Then find the Abbrechen button below it and change its `disabled` prop from `disabled={exporting}` to `disabled={collecting || exporting}`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm --prefix web/manifest run test -- List.test.tsx -t "Export-Warnung"
```

Expected: PASS, 11 tests.

- [ ] **Step 7: Check nothing else broke**

```bash
npm --prefix web/manifest run test
```

Expected: PASS. The existing collect tests scope their button lookup with `within(openTable())`, so the new `Alle kassieren und exportieren` button — which lives outside both tables — cannot make them ambiguous.

- [ ] **Step 8: Commit**

```bash
git add web/manifest/src/List.tsx web/manifest/src/List.test.tsx
git commit -m "feat(export): Alle offenen Tandems auf einmal kassieren und exportieren

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015hDbRGs5uMPUfVQXRQBhgc"
```

---

### Task 3: Style the panel, and stop it outliving its day

**Files:**
- Modify: `web/manifest/src/index.css` (after the `.day-outdated p` rule, line 803)
- Modify: `web/manifest/src/List.tsx` (the date effect at lines 193-197)
- Test: `web/manifest/src/List.test.tsx`

**Interfaces:**
- Consumes: `setExportWarning` from Task 1.
- Produces: the `.export-warning` and `.export-warning-actions` CSS classes. Nothing depends on them.

- [ ] **Step 1: Write the failing test**

Add this test inside the `describe('Export-Warnung', ...)` block, before its closing `})`.

```tsx
    // Counts belong to the day they were taken on. Left standing across a date
    // change, the panel would describe yesterday over today's list.
    it('drops the warning when the operator switches days', async () => {
      const user = userEvent.setup()
      vi.mocked(api.list).mockResolvedValue([
        makeRow({ id: 1, payment_method: 'cash', price: 270 }),
      ])
      const { rerender } = render(
        <List onSelect={() => {}} date="2026-07-09" onDateChange={() => {}} />
      )
      await screen.findByText('Anna Muster')

      await user.click(exportButton())
      expect(await screen.findByText(/noch nicht kassiert/)).toBeInTheDocument()

      rerender(<List onSelect={() => {}} date="2026-07-10" onDateChange={() => {}} />)

      await waitFor(() =>
        expect(screen.queryByText(/noch nicht kassiert/)).not.toBeInTheDocument())
    })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm --prefix web/manifest run test -- List.test.tsx -t "switches days"
```

Expected: FAIL — the panel is still in the document after the rerender.

- [ ] **Step 3: Clear the panel with the day**

In `web/manifest/src/List.tsx`, find this effect (currently lines 193-197):

```tsx
  // Cleared when the day changes so the banner cannot describe the day before;
  // refetched after every refresh so it reflects a reprice straight away.
  useEffect(() => {
    setDay(null)
  }, [date])
```

Replace with:

```tsx
  // Cleared when the day changes so the banner cannot describe the day before;
  // refetched after every refresh so it reflects a reprice straight away. The
  // export warning goes the same way: its counts were taken on the day being
  // left, and standing over another day's list they would simply be wrong.
  useEffect(() => {
    setDay(null)
    setExportWarning(null)
  }, [date])
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm --prefix web/manifest run test -- List.test.tsx -t "switches days"
```

Expected: PASS.

- [ ] **Step 5: Style the panel**

In `web/manifest/src/index.css`, find this rule (currently lines 797-803):

```css
.day-outdated p {
  flex: 1;
  min-width: 260px;
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
}
```

Insert after it:

```css
/* Raised by Exportieren when the day is not ready to be written. Same ember
   frame as .day-outdated, which is what "there is something here for you to
   press" looks like on this screen; the buttons sit on their own row because one
   of them changes every open tandem on the list. */
.export-warning {
  margin-bottom: 12px;
  padding: 10px 14px;
  border: 1px solid var(--ember);
  border-radius: 8px;
  background: rgba(255, 106, 61, 0.08);
}

.export-warning p {
  margin: 0 0 8px;
  font-size: 13px;
  line-height: 1.45;
}

.export-warning-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
```

- [ ] **Step 6: Verify the whole thing builds and passes**

```bash
npm --prefix web/manifest run test
npm --prefix web/manifest run lint
npm --prefix web/manifest run build
```

Expected: tests PASS, lint reports no errors, `tsc -b && vite build` completes without a type error.

- [ ] **Step 7: Verify the e2e flow still exports**

```bash
npm run test:e2e
```

Expected: PASS. `tests/e2e/flow.spec.ts:191` presses Exportieren after collecting its one row with Karte, so that day has nothing open and no missing Zahlungsart — the panel must not appear. If it does, the guard in `handleExport` or the `noPaymentRows` predicate is counting a row it should not.

- [ ] **Step 8: Commit**

```bash
git add web/manifest/src/List.tsx web/manifest/src/List.test.tsx web/manifest/src/index.css
git commit -m "feat(export): Warnpanel bekommt den Ember-Rahmen und endet mit seinem Tag

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015hDbRGs5uMPUfVQXRQBhgc"
```

---

## Manual check before calling it done

The suite cannot see colour or layout. On a running app (`npm start`, then the manifest at `http://localhost:<port>/manifest`):

1. Register two guests on today's date, leave both open, give one `Gutschein` as Zahlungsart.
2. Press **Exportieren**. The panel appears under the toolbar with the ember frame, reads `2 Tandems sind noch nicht kassiert, davon 1 mit Gutschein.` and carries three buttons.
3. Press **Abbrechen** — the panel disappears, no file is written to the export directory.
4. Press **Exportieren** again, then **Alle kassieren und exportieren**. Both rows move to the Kassiert table, the sheet is written, and the message line names the path.
5. Press **Exportieren** once more. No panel: the day is collected and paid for.
