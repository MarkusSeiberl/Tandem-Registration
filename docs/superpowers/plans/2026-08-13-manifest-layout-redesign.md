# Manifest Layout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Einstellungen screen so it fits one desktop viewport without page scrolling, and rebalance the Detail screen so the short Gastdaten block and the very long Manifest column no longer sit side by side.

**Architecture:** Both screens move from a single tall stack to a panel grid built on two new shared CSS primitives — `.panel` (a titled card) and `.save-bar` (a sticky commit strip at the bottom edge). Einstellungen becomes two columns: paths/backup on the left, the two long guest texts in one right-hand panel with a tab switcher whose textarea takes the height the window has instead of the height ten rows add up to. Detail turns Gastdaten into a horizontal fact strip across the top (the guest's data is read-only and never changes on this screen) and splits the Manifest column into three panels — Zuteilung, Leistung, Kassa — across the full width.

**Tech Stack:** React 19 + TypeScript, plain CSS (`web/manifest/src/index.css`), Vitest + Testing Library + jsdom, Vite.

## Global Constraints

- **Target viewport:** desktop 1920×1080. Three columns must be comfortable at that width. Narrower widths fall back to two columns and then one; they may scroll.
- **No new design tokens.** The palette, type, and radii already in `:root` of `web/manifest/src/index.css` are the system: `--ink`, `--ember`, `--sky`, `--text`, `--text-h`, `--bg`, `--panel-bg`, `--border`, `--accent`, `--accent-contrast`, `--error`, `--row-hover`, `--sans`, `--mono`. Do not add colors and do not introduce a second visual identity.
- **All UI copy stays German**, exactly as it reads today. Every existing label string is load-bearing for tests — do not reword `Export-Verzeichnis`, `Ort (für Vertragsunterschrift)`, `Backup-Verzeichnis (leer = Export-Verzeichnis)`, `Gutscheinliste (Excel-Datei)`, `Datenschutztext`, `Vertragstext`, `Speichern`, `Backup erstellen`, `Tandemmaster`, `Load-Nr.`, `Zahlungsart`, `Gutschein-Nr.`, `Gutschein-Leistung`, `Zuzahlung bezahlt mit`, `Gebuchte Leistung`, `Gewichtszuschlag`, `Kameraflieger`, `Anmerkungen`, `Zu kassieren`, `abweichender Preis`, `Preis (EUR)`.
- **Class names asserted by tests must survive**: `.price-total`, `.numeral`, `.voucher-status`, `.field-hint`, `.voucher-check`, and the `<fieldset>`/`<legend>` pair that gives the voucher block `role="group"` with the accessible name `Gutschein`.
- **Accessibility floor:** every panel is a `<section aria-label="…">` so it exposes `role="region"`; tabs use `role="tablist"`/`role="tab"`/`role="tabpanel"`; keyboard focus stays visible; no motion added.
- **Test command:** `npm --prefix web/manifest run test`. Type check: `npm --prefix web/manifest exec -- tsc -b`.

## Design direction

The subject is a manifest desk at a dropzone: an operator standing at a counter with one guest in front of them, assigning a tandem master and collecting money before a load goes up. The screen's job is *decide and collect*, not *browse*.

- **Color / type:** unchanged from the existing system. The one deliberate reuse is `--mono` via the existing `.numeral` class — on this screen weights, ages, load numbers, and euro amounts are instrument readouts, not prose, and they already read that way in the list.
- **Structure encodes the work:** the three Detail panels are named for the three decisions the manifest actually makes — *Zuteilung* (who flies them), *Leistung* (what they get), *Kassa* (what they pay). This is not decorative numbering; it is the order of the counter conversation.
- **Signature:** the guest fact strip. The guest's data is fixed, arrives from the kiosk, and is never edited here, so it reads as one dense load-sheet line across the top — small uppercase labels over mono values — with `--ember` on the left edge and the weight set bold, because weight is the single guest fact that costs money further down the screen.
- **Restraint:** boldness is spent on that strip alone. Every other surface is a quiet `--panel-bg` card with a hairline border and an uppercase eyebrow. No animation, no gradients, no new accent.

*Self-check against the default look:* the tempting generic answer here is a cream/serif dashboard or a card grid with a big colored KPI tile for the total. Rejected — the app already has a committed dark/light system with a green accent, and a second identity bolted onto two screens would read as a different product. The total stays a plain `.price-total` row inside the Kassa panel, weighted by type rather than by a colored tile.

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `web/manifest/src/index.css` | All styling. Gains `.panel`, `.panel-title`, `.save-bar`, `.settings-cols`, `.text-tabs`, `.guest-strip`, `.detail-cols`, `.kassa-panel`. Loses `.guest-data*`, `.detail-row`, `.detail-grid`, `.price-box`, `.backup-section`, `.settings-screen .field`. | Modify |
| `web/manifest/src/App.tsx` | App shell. Adds a `view-wide` modifier so Detail/Einstellungen get more than 1400px on a 1920 monitor. | Modify |
| `web/manifest/src/Settings.tsx` | Einstellungen screen. Two-column panel layout + text tabs + sticky save bar. | Modify |
| `web/manifest/src/Detail.tsx` | Detail screen. Guest fact strip + three panels + sticky action bar. | Modify |
| `web/manifest/src/Settings.test.tsx` | Adds region-grouping and tab-switching tests. | Modify |
| `web/manifest/src/Detail.test.tsx` | Adds guest-strip and panel-grouping tests. | Modify |

No files are created. No behavior, API call, or saved field changes anywhere in this plan — this is layout and grouping only.

---

### Task 1: Shared panel primitives and the two-column Einstellungen shell

**Files:**
- Modify: `web/manifest/src/index.css` (add primitives; replace `.settings-screen .field` / `.backup-section` block at lines 704–732)
- Modify: `web/manifest/src/App.tsx:66-73`
- Modify: `web/manifest/src/Settings.tsx:161-282`
- Test: `web/manifest/src/Settings.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: CSS classes `.panel`, `.panel-title`, `.save-bar`, `.settings-cols`, `.settings-col`, `.text-panel`, and the `view-wide` modifier on `<main className="view">`. Tasks 2–5 rely on `.panel` being a flex column with `gap: 14px` and on `.save-bar` being `position: sticky; bottom: 0`.

- [ ] **Step 1: Write the failing test**

In `web/manifest/src/Settings.test.tsx`, change the Testing Library import on line 2 to include `within`:

```tsx
import { render, screen, waitFor, within } from '@testing-library/react'
```

Then add this test inside the `describe('Settings', …)` block, after the existing `it('saves the directories and the jump location', …)`:

```tsx
  it('groups the paths and the backup into blocks of their own', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Everything that points at the disk, in one block: the operator sets these
    // once at the start of a season and does not read past them again.
    const paths = screen.getByRole('region', { name: 'Pfade & Ort' })
    expect(within(paths).getByLabelText('Export-Verzeichnis')).toBeInTheDocument()
    expect(within(paths).getByLabelText('Backup-Verzeichnis (leer = Export-Verzeichnis)'))
      .toBeInTheDocument()
    expect(within(paths).getByLabelText('Gutscheinliste (Excel-Datei)')).toBeInTheDocument()
    expect(within(paths).getByLabelText('Ort (für Vertragsunterschrift)')).toBeInTheDocument()

    // The backup button acts on its own; it is not part of what Speichern commits.
    const backup = screen.getByRole('region', { name: 'Datenbank-Backup' })
    expect(within(backup).getByRole('button', { name: 'Backup erstellen' })).toBeInTheDocument()
    expect(within(backup).queryByRole('button', { name: 'Speichern' })).not.toBeInTheDocument()

    // The guest texts are their own block, away from the paths.
    const texts = screen.getByRole('region', { name: 'Texte' })
    expect(within(texts).getByLabelText(/Datenschutztext/)).toBeInTheDocument()
    expect(within(texts).getByLabelText(/Vertragstext/)).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web/manifest run test -- Settings`

Expected: FAIL — `Unable to find an accessible element with the role "region" and name "Pfade & Ort"`.

- [ ] **Step 3: Add the shared CSS primitives**

In `web/manifest/src/index.css`, replace the `.view` rule (lines 124–130) with:

```css
.view {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 28px 32px;
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}

/* The screens that lay fields out in columns rather than rows. On a desk
   monitor a 1400px cap would leave a third of the glass empty while the middle
   column still wraps. The list keeps the narrower cap: a table that wide is
   harder to read across, not easier. */
.view-wide {
  max-width: 1720px;
}
```

Then append these primitives at the end of the file:

```css
/* A titled card. The eyebrow names what the block decides, not what the fields
   are called — the fields already say that. */
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-bg);
}

.panel-title {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text);
  opacity: 0.6;
}

/* The one control that commits the screen, always at the bottom edge and always
   in the same place, so a change made in the far column is saved without
   hunting for the button that does it. */
.save-bar {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 4px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
  background: var(--bg);
}

.save-bar p {
  margin: 0;
}

.save-bar .btn.primary {
  margin-left: auto;
}
```

- [ ] **Step 4: Add the Einstellungen layout CSS**

In `web/manifest/src/index.css`, replace the whole `/* Settings screen */` block — the `.settings-screen .field`, `.settings-screen .path-row`, `.settings-screen .path-row input`, `.settings-screen .path-row .btn` and `.backup-section` rules at lines 704–732 — with:

```css
/* Settings screen: two columns on a desk monitor. Everything that names a place
   on disk goes left; the two long guest texts get a panel of their own on the
   right that takes the height the window has instead of the height ten rows add
   up to. The page does not scroll — the open text does. */
.settings-screen {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-cols {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(380px, 560px) 1fr;
  gap: 24px;
}

.settings-col {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-content: start;
}

/* The one block allowed to take all the height there is. */
.text-panel {
  min-height: 0;
}

.settings-screen .field {
  margin: 0;
}

/* Path field: the text stays as wide as it can, the dialog button sits beside it
   at its own width. */
.settings-screen .path-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.settings-screen .path-row input {
  flex: 1;
  min-width: 0;
}

.settings-screen .path-row .btn {
  white-space: nowrap;
}

/* Below a wide desk monitor the two columns stack and the page may scroll —
   which is the honest trade, since neither column fits beside the other. */
@media (max-width: 1180px) {
  .settings-cols {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Give the column screens the wider view**

In `web/manifest/src/App.tsx`, replace lines 66–73 with:

```tsx
        <main className={view === 'list' ? 'view' : 'view view-wide'}>
          {view === 'list' && <List onSelect={openDetail} />}
          {view === 'detail' && selected && (
            <Detail registration={selected} onBack={closeDetail} onSaved={setSelected} />
          )}
          {view === 'stammdaten' && <Stammdaten />}
          {view === 'settings' && <Settings />}
        </main>
```

- [ ] **Step 6: Restructure the Einstellungen markup**

In `web/manifest/src/Settings.tsx`, replace the whole `return ( … )` block of the `Settings` component (lines 161–282, i.e. everything from `return (` down to the closing `)` before the final `}`) with:

```tsx
  return (
    <div className="settings-screen">
      <h2>Einstellungen</h2>

      <div className="settings-cols">
        <div className="settings-col">
          <section className="panel" aria-label="Pfade & Ort">
            <h3 className="panel-title">Pfade &amp; Ort</h3>

            <PathField
              label="Export-Verzeichnis"
              browseLabel="Export-Verzeichnis auswählen"
              kind="directory"
              value={exportDir}
              state={checks.exportDir}
              onChange={(value) => {
                setExportDir(value)
                setSaved(false)
              }}
              onBrowse={canPick ? () => browse('directory', exportDir, setExportDir) : undefined}
              browsing={browsing}
            />

            <PathField
              label="Backup-Verzeichnis (leer = Export-Verzeichnis)"
              browseLabel="Backup-Verzeichnis auswählen"
              kind="directory"
              value={backupDir}
              state={checks.backupDir}
              onChange={(value) => {
                setBackupDir(value)
                setSaved(false)
              }}
              onBrowse={canPick ? () => browse('directory', backupDir, setBackupDir) : undefined}
              browsing={browsing}
            />

            <PathField
              label="Gutscheinliste (Excel-Datei)"
              browseLabel="Gutscheinliste auswählen"
              kind="excel-file"
              value={voucherListPath}
              state={checks.voucherListPath}
              hint={
                'Vollständiger Pfad zur Tandemliste des Vereins. Leer lassen, wenn keine ' +
                'Gutscheinprüfung gewünscht ist.'
              }
              onChange={(value) => {
                setVoucherListPath(value)
                setSaved(false)
              }}
              onBrowse={
                canPick ? () => browse('excel-file', voucherListPath, setVoucherListPath) : undefined
              }
              browsing={browsing}
            />

            <label className="field">
              Ort (für Vertragsunterschrift)
              <input
                type="text"
                value={jumpLocation}
                onChange={(e) => {
                  setJumpLocation(e.target.value)
                  setSaved(false)
                }}
              />
            </label>
          </section>

          {/*
            Its own block because its button acts on its own: Backup erstellen
            runs immediately and is not part of what Speichern commits.
          */}
          <section className="panel" aria-label="Datenbank-Backup">
            <h3 className="panel-title">Datenbank-Backup</h3>
            <p className="field-hint">
              Erstellt eine Sicherungskopie der Datenbank im Backup-Verzeichnis. Verzeichnis vorher
              speichern.
            </p>
            {backupError && <p className="error">{backupError}</p>}
            {backupMessage && !backupError && <p className="hint">{backupMessage}</p>}
            <div>
              <button
                type="button"
                className="btn secondary"
                onClick={handleBackup}
                disabled={backingUp}
              >
                {backingUp ? 'Erstellt…' : 'Backup erstellen'}
              </button>
            </div>
          </section>
        </div>

        {/*
          Both texts the guest gets to read before signing. They live here rather
          than only in config.json because a wrong address or an outdated retention
          period is a legal problem, and fixing it must not need a new build.
        */}
        <section className="panel text-panel" aria-label="Texte">
          <h3 className="panel-title">Texte für den Gast</h3>

          <label className="field">
            Datenschutztext
            <textarea
              rows={10}
              value={privacyText}
              onChange={(e) => {
                setPrivacyText(e.target.value)
                setSaved(false)
              }}
            />
            <span className="field-hint">
              Wird dem Gast vor der Unterschrift gezeigt und muss von ihm bestätigt werden.
              Angaben in eckigen Klammern ersetzen.
            </span>
          </label>

          <label className="field">
            Vertragstext
            <textarea
              rows={10}
              value={contractText}
              onChange={(e) => {
                setContractText(e.target.value)
                setSaved(false)
              }}
            />
            <span className="field-hint">
              Der Beförderungsvertrag, den der Gast liest und unterschreibt.
            </span>
          </label>
        </section>
      </div>

      <div className="save-bar">
        {error && <p className="error">{error}</p>}
        {saved && !error && <p className="hint">Gespeichert.</p>}
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </div>
  )
```

- [ ] **Step 7: Run the Einstellungen tests**

Run: `npm --prefix web/manifest run test -- Settings`

Expected: PASS — all tests in `Settings.test.tsx`, including the pre-existing ones (`saves the directories and the jump location`, `edits the texts the guest is shown before signing`, the three browse-button tests, both path-warning tests, and `leaves the amounts to the Stammdaten screen`).

- [ ] **Step 8: Type check**

Run: `npm --prefix web/manifest exec -- tsc -b`

Expected: no output, exit code 0.

- [ ] **Step 9: Commit**

```bash
git add web/manifest/src/index.css web/manifest/src/App.tsx web/manifest/src/Settings.tsx web/manifest/src/Settings.test.tsx
git commit -m "refactor(manifest): lay the settings screen out in two columns of panels"
```

---

### Task 2: Guest texts as one tabbed panel that fills the viewport

**Files:**
- Modify: `web/manifest/src/Settings.tsx` (state at the top of the component; the `<section className="panel text-panel">` block from Task 1)
- Modify: `web/manifest/src/index.css` (append tab styles)
- Test: `web/manifest/src/Settings.test.tsx`

**Interfaces:**
- Consumes: `.panel`, `.text-panel`, `.settings-cols` from Task 1.
- Produces: nothing later tasks depend on. Both textareas stay mounted at all times (the inactive one carries the `hidden` attribute), so unsaved edits survive a tab switch and `putSettings` always sends both texts.

- [ ] **Step 1: Write the failing tests**

Add these two tests to `web/manifest/src/Settings.test.tsx`, inside the `describe('Settings', …)` block:

```tsx
  it('shows one guest text at a time and switches on the tab', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    // Ten rows of legal text twice over is what made this screen scroll. One at
    // a time, in the height the window actually has.
    expect(screen.getByLabelText('Datenschutztext')).toBeVisible()
    expect(screen.getByLabelText('Vertragstext')).not.toBeVisible()

    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))

    expect(screen.getByLabelText('Vertragstext')).toBeVisible()
    expect(screen.getByLabelText('Datenschutztext')).not.toBeVisible()
  })

  it('keeps an edit made in the tab that is no longer showing, and saves both', async () => {
    render(<Settings />)
    await screen.findByLabelText('Export-Verzeichnis')

    await userEvent.clear(screen.getByLabelText('Datenschutztext'))
    await userEvent.type(screen.getByLabelText('Datenschutztext'), 'Neue Datenschutzinfo')

    // Switching away is not discarding. Both fields stay mounted, so Speichern
    // still commits the text the operator cannot see at that moment.
    await userEvent.click(screen.getByRole('tab', { name: 'Vertragstext' }))
    await userEvent.clear(screen.getByLabelText('Vertragstext'))
    await userEvent.type(screen.getByLabelText('Vertragstext'), 'Neuer Vertrag')

    await userEvent.click(screen.getByRole('tab', { name: 'Datenschutztext' }))
    expect((screen.getByLabelText('Datenschutztext') as HTMLTextAreaElement).value)
      .toBe('Neue Datenschutzinfo')

    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    expect(vi.mocked(api.putSettings).mock.calls[0][0]).toMatchObject({
      privacyText: 'Neue Datenschutzinfo',
      contractText: 'Neuer Vertrag',
    })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web/manifest run test -- Settings`

Expected: FAIL — `Unable to find an accessible element with the role "tab" and name "Vertragstext"`.

- [ ] **Step 3: Add the tab state**

In `web/manifest/src/Settings.tsx`, inside the `Settings` component, add this next to the other `useState` calls (immediately after the `const [checks, setChecks] = useState<PathChecks>({})` line):

```tsx
  // Both texts stay mounted; only one is shown. Unmounting the other would throw
  // away an edit the operator made before switching, and Speichern commits both.
  const [textTab, setTextTab] = useState<'privacy' | 'contract'>('privacy')
  const textIds = useId()
```

`useId` is already imported on line 1 of the file (`import { useEffect, useId, useState } from 'react'`).

- [ ] **Step 4: Replace the text panel markup**

In `web/manifest/src/Settings.tsx`, replace the entire `<section className="panel text-panel" aria-label="Texte"> … </section>` block written in Task 1 with:

```tsx
        {/*
          Both texts the guest gets to read before signing. They live here rather
          than only in config.json because a wrong address or an outdated retention
          period is a legal problem, and fixing it must not need a new build. One
          shows at a time: two ten-row textareas stacked is what made this screen
          longer than the window.
        */}
        <section className="panel text-panel" aria-label="Texte">
          <div className="text-tabs" role="tablist" aria-label="Texte für den Gast">
            <button
              type="button"
              role="tab"
              className="text-tab"
              id={`${textIds}-privacy-tab`}
              aria-controls={`${textIds}-privacy-panel`}
              aria-selected={textTab === 'privacy'}
              onClick={() => setTextTab('privacy')}
            >
              Datenschutztext
            </button>
            <button
              type="button"
              role="tab"
              className="text-tab"
              id={`${textIds}-contract-tab`}
              aria-controls={`${textIds}-contract-panel`}
              aria-selected={textTab === 'contract'}
              onClick={() => setTextTab('contract')}
            >
              Vertragstext
            </button>
          </div>

          <div
            className="text-body"
            role="tabpanel"
            id={`${textIds}-privacy-panel`}
            aria-labelledby={`${textIds}-privacy-tab`}
            hidden={textTab !== 'privacy'}
          >
            <textarea
              aria-label="Datenschutztext"
              value={privacyText}
              onChange={(e) => {
                setPrivacyText(e.target.value)
                setSaved(false)
              }}
            />
            <span className="field-hint">
              Wird dem Gast vor der Unterschrift gezeigt und muss von ihm bestätigt werden.
              Angaben in eckigen Klammern ersetzen.
            </span>
          </div>

          <div
            className="text-body"
            role="tabpanel"
            id={`${textIds}-contract-panel`}
            aria-labelledby={`${textIds}-contract-tab`}
            hidden={textTab !== 'contract'}
          >
            <textarea
              aria-label="Vertragstext"
              value={contractText}
              onChange={(e) => {
                setContractText(e.target.value)
                setSaved(false)
              }}
            />
            <span className="field-hint">
              Der Beförderungsvertrag, den der Gast liest und unterschreibt.
            </span>
          </div>
        </section>
```

Note the `<h3 className="panel-title">` is gone from this panel on purpose: the tab row already names what is in it, and a heading plus two tabs saying the same three words is the accessory to remove.

- [ ] **Step 5: Add the tab CSS**

Append to `web/manifest/src/index.css`:

```css
/* Two texts, one panel. The tab row is the only place on this screen where a
   control names a document rather than a field, so it is set apart by a rule
   under it rather than by a box around it. */
.text-tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border);
}

.text-tab {
  font: inherit;
  font-size: 14px;
  padding: 8px 14px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.text-tab:hover {
  background: var(--row-hover);
}

.text-tab[aria-selected='true'] {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.text-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* `hidden` has to beat the flex display above it, or the closed tab stays open. */
.text-body[hidden] {
  display: none;
}

/* The text takes the height the panel has. Resizing it by hand would only make
   the page scroll again, which is the thing this layout exists to stop. */
.text-body textarea {
  flex: 1;
  min-height: 220px;
  resize: none;
  font: inherit;
  padding: 10px 12px;
  border: 2px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
  color: var(--text);
}

/* Stacked under the left column there is no window height to fill, so the text
   takes a fixed, comfortable block instead. */
@media (max-width: 1180px) {
  .text-body textarea {
    min-height: 300px;
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `npm --prefix web/manifest run test -- Settings`

Expected: PASS. The pre-existing test `edits the texts the guest is shown before signing` still passes — it queries `getByLabelText(/Datenschutztext/)` and `getByLabelText(/Vertragstext/)`, and `getByLabelText` matches an `aria-label` and does not filter out hidden elements.

- [ ] **Step 7: Type check**

Run: `npm --prefix web/manifest exec -- tsc -b`

Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add web/manifest/src/index.css web/manifest/src/Settings.tsx web/manifest/src/Settings.test.tsx
git commit -m "feat(manifest): show the guest texts one tab at a time at full window height"
```

---

### Task 3: The guest fact strip on the Detail screen

**Files:**
- Modify: `web/manifest/src/Detail.tsx:213-266` (the `<section className="guest-data">` block)
- Modify: `web/manifest/src/index.css` (replace `.guest-data*` / `.detail-row` rules at lines 450–469)
- Test: `web/manifest/src/Detail.test.tsx`

**Interfaces:**
- Consumes: `.panel` conventions from Task 1 (the strip is a sibling card, not a `.panel` — it has its own class).
- Produces: `<header className="guest-strip" aria-label="Gastdaten">` exposing `role="region"` named `Gastdaten`, and the CSS classes `.guest-strip`, `.guest-name`, `.guest-facts`, `.guest-contact`, `.fact`, `.fact-weight`. Task 4 places `.detail-cols` directly below it.

- [ ] **Step 1: Write the failing test**

Add this test to `web/manifest/src/Detail.test.tsx`, inside the `describe('Detail', …)` block, right after `it('shows the jump price for a guest with nothing selected', …)`:

```tsx
  it('reads the guest as one strip of facts above the manifest', async () => {
    renderDetail()
    await screen.findByText('Zu kassieren')

    // Nothing here is editable and nothing here changes on this screen, so it
    // reads as one line across the top rather than as a column competing for
    // width with the fields that do change.
    const guest = screen.getByRole('region', { name: 'Gastdaten' })
    expect(within(guest).getByText('Anna Muster')).toBeInTheDocument()
    expect(within(guest).getByText('weiblich')).toBeInTheDocument()
    expect(within(guest).getByText('30')).toBeInTheDocument()
    expect(within(guest).getByText('170 cm')).toBeInTheDocument()
    expect(within(guest).getByText('80 kg')).toBeInTheDocument()
    expect(within(guest).getByText('2026-07-09')).toBeInTheDocument()
    expect(within(guest).getByText('Hauptstraße 1, 5020 Salzburg')).toBeInTheDocument()
    expect(within(guest).getByText('anna@example.com')).toBeInTheDocument()
    expect(within(guest).getByText('0664 1234567')).toBeInTheDocument()

    // The strip states facts; it never asks for one.
    expect(within(guest).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(guest).queryByRole('combobox')).not.toBeInTheDocument()
  })
```

`weiblich` is what `genderLabel('female')` returns — see `GENDERS` in `web/manifest/src/labels.ts:8-12`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web/manifest run test -- Detail`

Expected: FAIL — `Unable to find an accessible element with the role "region" and name "Gastdaten"`.

- [ ] **Step 3: Replace the guest markup**

In `web/manifest/src/Detail.tsx`, replace the entire `<section className="guest-data"> … </section>` block (lines 220–266) with this `<header>`, and move it **out** of `.detail-grid` so it sits directly under the back button as a sibling:

```tsx
      {/*
        The guest arrives from the kiosk and is never edited here, so all nine
        facts read as one load-sheet line across the top instead of as a column
        of their own. Weight is set apart because it is the one guest fact that
        costs money: it sets the Gewichtszuschlag further down the screen.
      */}
      <header className="guest-strip" aria-label="Gastdaten">
        <h2 className="guest-name">
          {registration.first_name} {registration.last_name}
        </h2>

        <dl className="guest-facts">
          <div className="fact">
            <dt>Geschlecht</dt>
            <dd>{genderLabel(registration.gender)}</dd>
          </div>
          <div className="fact">
            <dt>Alter</dt>
            <dd className="numeral">{registration.age}</dd>
          </div>
          <div className="fact">
            <dt>Größe</dt>
            <dd className="numeral">
              {registration.height_cm != null ? `${registration.height_cm} cm` : ''}
            </dd>
          </div>
          <div className="fact fact-weight">
            <dt>Gewicht</dt>
            <dd className="numeral">{registration.weight_kg} kg</dd>
          </div>
          <div className="fact">
            <dt>Sprungdatum</dt>
            <dd className="numeral">{registration.jump_date}</dd>
          </div>
        </dl>

        <dl className="guest-contact">
          <div className="fact">
            <dt>Adresse</dt>
            <dd>
              {registration.street}, {registration.postal_code} {registration.city}
            </dd>
          </div>
          <div className="fact">
            <dt>E-Mail</dt>
            <dd>{registration.email}</dd>
          </div>
          <div className="fact">
            <dt>Telefon</dt>
            <dd>{registration.phone}</dd>
          </div>
        </dl>
      </header>
```

Leave the `<div className="detail-grid">` wrapper and the `<section className="manifest-fields">` inside it exactly as they are for now — Task 4 replaces them.

- [ ] **Step 4: Replace the guest CSS**

In `web/manifest/src/index.css`, replace the `.guest-data dl`, `.detail-row`, `.guest-data dt` and `.guest-data dd` rules (lines 450–469) with:

```css
/* The guest strip. One rule of --ember down the left edge is the whole of the
   screen's boldness; every card below it stays a quiet panel. */
.guest-strip {
  padding: 16px 20px;
  border: 1px solid var(--border);
  border-left: 3px solid var(--ember);
  border-radius: 10px;
  background: var(--panel-bg);
}

.guest-name {
  margin: 0 0 12px;
  font-size: 24px;
}

.guest-facts,
.guest-contact {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 32px;
  margin: 0;
}

/* Address, mail and phone are looked up rarely — a hairline separates them from
   the five facts the manifest reads on every row without hiding them. */
.guest-contact {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.fact {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.fact dt {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text);
  opacity: 0.55;
}

.fact dd {
  margin: 0;
  font-size: 15px;
  color: var(--text-h);
}

/* The one guest fact that costs money. */
.fact-weight dd {
  font-weight: 700;
}
```

- [ ] **Step 5: Run the tests**

Run: `npm --prefix web/manifest run test -- Detail`

Expected: PASS — the new test plus all 38 pre-existing `Detail` tests.

- [ ] **Step 6: Type check**

Run: `npm --prefix web/manifest exec -- tsc -b`

Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add web/manifest/src/index.css web/manifest/src/Detail.tsx web/manifest/src/Detail.test.tsx
git commit -m "feat(manifest): read the guest as one fact strip above the detail fields"
```

---

### Task 4: Split the manifest column into Zuteilung, Leistung and Kassa

**Files:**
- Modify: `web/manifest/src/Detail.tsx` (the `.detail-grid` / `.manifest-fields` block that remains after Task 3)
- Modify: `web/manifest/src/index.css` (replace `.detail-grid`, `.manifest-fields`, `.price-box` rules)
- Test: `web/manifest/src/Detail.test.tsx`

**Interfaces:**
- Consumes: `.panel` / `.panel-title` from Task 1, `.guest-strip` from Task 3.
- Produces: three `role="region"` panels named `Zuteilung`, `Leistung`, `Kassa`, plus `.detail-cols` and `.kassa-panel`. Task 5 attaches the sticky action bar below `.detail-cols` and makes `.kassa-panel` sticky.

- [ ] **Step 1: Write the failing test**

Add this test to `web/manifest/src/Detail.test.tsx`, inside the `describe('Detail', …)` block:

```tsx
  it('splits the manifest into who flies them, what they get and what they pay', async () => {
    const user = userEvent.setup()
    renderDetail()
    await screen.findByText('Zu kassieren')

    // Who flies them, and on whose money.
    const zuteilung = screen.getByRole('region', { name: 'Zuteilung' })
    expect(within(zuteilung).getByLabelText('Tandemmaster')).toBeInTheDocument()
    expect(within(zuteilung).getByLabelText('Load-Nr.')).toBeInTheDocument()
    expect(within(zuteilung).getByLabelText('Zahlungsart')).toBeInTheDocument()

    // What they get.
    const leistung = screen.getByRole('region', { name: 'Leistung' })
    expect(within(leistung).getByLabelText(/Gebuchte Leistung/)).toBeInTheDocument()
    expect(within(leistung).getByLabelText(/Gewichtszuschlag/)).toBeInTheDocument()
    expect(within(leistung).getByLabelText(/Kameraflieger/)).toBeInTheDocument()
    expect(within(leistung).getByLabelText(/Anmerkungen/)).toBeInTheDocument()

    // What they pay.
    const kassa = screen.getByRole('region', { name: 'Kassa' })
    expect(within(kassa).getByText('Zu kassieren')).toBeInTheDocument()
    expect(within(kassa).getByLabelText('abweichender Preis')).toBeInTheDocument()

    // The voucher block still hangs off the Zahlungsart that summons it, in the
    // same panel — a block that opened in a different column would open where
    // nobody is looking.
    await user.selectOptions(within(zuteilung).getByLabelText('Zahlungsart'), 'voucher')
    expect(within(zuteilung).getByRole('group', { name: 'Gutschein' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web/manifest run test -- Detail`

Expected: FAIL — `Unable to find an accessible element with the role "region" and name "Zuteilung"`.

- [ ] **Step 3: Replace the manifest markup**

In `web/manifest/src/Detail.tsx`, replace everything from `<div className="detail-grid">` down to its closing `</div>` (i.e. the wrapper plus the whole `<section className="manifest-fields">`) with:

```tsx
      <div className="detail-cols">
        <section className="panel" aria-label="Zuteilung">
          <h3 className="panel-title">Zuteilung</h3>

          <label className="field">
            Tandemmaster
            <select
              value={tandemMasterId}
              onChange={(e) => setTandemMasterId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— auswählen —</option>
              {masterList.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            Load-Nr.
            <input
              type="number"
              className="numeral"
              value={loadNumber}
              onChange={(e) => setLoadNumber(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </label>

          <label className="field">
            Zahlungsart
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod | '')}>
              <option value="">— auswählen —</option>
              {PAYMENT_METHODS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          {/*
            One block, tied to the payment method right above it and kept in the
            same column as it: everything the voucher needs appears and
            disappears together, and the till comes after the two fields that
            decide its amount.
          */}
          {showVoucherNumber && (
            <fieldset className="voucher-group">
              <legend>Gutschein</legend>

              <label className="field">
                Gutschein-Nr.
                <input
                  type="text"
                  value={voucherNumber}
                  onChange={(e) => setVoucherNumber(e.target.value)}
                />
                {voucherLine && (
                  <span className={`field-hint voucher-check ${voucherLine.tone}`}>
                    {voucherLine.text}
                  </span>
                )}
                {voucherArtLine && (
                  <span className={`field-hint voucher-check ${voucherArtLine.tone}`}>
                    {voucherArtLine.text}
                  </span>
                )}
                {voucherAmountLine && (
                  <span className={`field-hint voucher-check ${voucherAmountLine.tone}`}>
                    {voucherAmountLine.text}
                  </span>
                )}
              </label>

              <label className="field">
                Gutschein-Leistung
                <select
                  name="voucher_service"
                  value={voucherService}
                  onChange={(e) => {
                    const next = e.target.value as VoucherService | ''
                    setVoucherService(next)
                    // The guest flies at least what the voucher covers, so raise
                    // the booking to match — otherwise the voucher would be worth
                    // more than the service and the difference would read as 0.
                    setExtraBooking((current) => atLeast(current, serviceOfVoucher(next)))
                  }}
                >
                  <option value="">— auswählen —</option>
                  {VOUCHER_SERVICES.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Was der Gutschein abdeckt. Wird vom Preis abgezogen.
                </span>
              </label>

              <p className={tillMissing ? 'voucher-status warn' : 'voucher-status'}>
                {voucherStatus}
              </p>

              <label className="field">
                Zuzahlung bezahlt mit
                <select
                  name="voucher_payment_method"
                  disabled={!showVoucherPayment}
                  value={showVoucherPayment ? voucherPaymentMethod : ''}
                  onChange={(e) => setVoucherPaymentMethod(e.target.value as CollectedVia | '')}
                >
                  <option value="">— auswählen —</option>
                  {COLLECTED_VIA.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <span className="field-hint">
                  Zählt am Abend in die Bar- bzw. Kartensumme.
                </span>
              </label>
            </fieldset>
          )}

          {/*
            Outside the voucher block on purpose, directly under it: what the
            club's file already carries stays true even after the payment method
            is moved away from Gutschein, which is precisely when the row stops
            naming the voucher the date sits on.
          */}
          {redemptionLine && (
            <p className="field-hint voucher-redemption">{redemptionLine}</p>
          )}
        </section>

        <section className="panel" aria-label="Leistung">
          <h3 className="panel-title">Leistung</h3>

          <label className="field">
            Gebuchte Leistung
            <select value={extraBooking} onChange={(e) => setExtraBooking(e.target.value as ExtraBooking)}>
              {EXTRA_BOOKINGS.map((x) => (
                <option key={x.value} value={x.value}>
                  {x.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              {showVoucherNumber
                ? 'Was der Gast insgesamt bekommt. Der Gutschein wird davon abgezogen.'
                : 'Zusätzlich zum Sprung.'}
            </span>
          </label>

          <label className="field">
            Gewichtszuschlag
            <select
              value={weightSurcharge}
              onChange={(e) => setWeightSurcharge(e.target.value as WeightSurcharge)}
            >
              {WEIGHT_SURCHARGES.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                  {prices && w.value !== 'none'
                    ? ` (${formatEuro(w.value === 'over_90' ? prices.weight_over_90 : prices.weight_over_100)})`
                    : ''}
                </option>
              ))}
            </select>
            {/*
              Preset from the weight when the guest registered, and left alone
              afterwards. The hint only points out a disagreement — waiving the
              surcharge is the manifest's call, and a waiver that gets corrected
              back on the next save is not a waiver.
            */}
            <span className={surchargeDeviates ? 'field-hint warn' : 'field-hint'}>
              {surchargeDeviates
                ? `${registration.weight_kg} kg — ${
                    surchargeFromWeight === 'none'
                      ? 'kein Zuschlag fällig.'
                      : `Zuschlag ${surchargeFromWeight === 'over_90' ? 'ab 90 kg' : 'ab 100 kg'} wäre fällig.`
                  }`
                : `Eingetragenes Gewicht: ${registration.weight_kg} kg`}
            </span>
          </label>

          {/*
            Always in place, only usable when a video is actually flown — the
            field kept appearing and disappearing as the booking changed, which
            reflowed the form under the operator's hand.
          */}
          <label className="field">
            Kameraflieger
            <select
              disabled={!showCameraFlyer}
              value={showCameraFlyer ? cameraFlyerId : ''}
              onChange={(e) => setCameraFlyerId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">— auswählen —</option>
              {flyerList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            {!showCameraFlyer && <span className="field-hint">Kein Video gebucht.</span>}
          </label>

          {/*
            Last in this column on purpose: a note records the special
            arrangement behind the three choices above it. Among the dropdowns it
            would read as one more thing to fill in on every row.
          */}
          <label className="field">
            Anmerkungen
            <textarea
              name="notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
            <span className="field-hint">
              Besondere Vereinbarungen, Abweichungen, Sonderfälle. Steht im Excel-Export.
            </span>
          </label>
        </section>

        <section className="panel kassa-panel" aria-label="Kassa">
          <h3 className="panel-title">Kassa</h3>

          {/*
            Until the price table has arrived there is nothing honest to show —
            a 0 € total would be read as "guest owes nothing".
          */}
          {!prices && <p className="hint">Preise werden geladen…</p>}

          {prices && (
            <>
              <div className="price-breakdown">
                {lines.map((l) => (
                  <div className="price-line" key={l.label}>
                    <span>{l.label}</span>
                    <span className="numeral">{formatEuro(l.amount)}</span>
                  </div>
                ))}
              </div>
              <div className="price-line price-total">
                <span>Zu kassieren</span>
                <span className="numeral">{formatEuro(due)}</span>
              </div>
            </>
          )}

          <label className="price-override-toggle">
            <input
              type="checkbox"
              checked={priceOverride}
              onChange={(e) => {
                setPriceOverride(e.target.checked)
                // Start the manual field from the amount currently computed, so
                // a small correction is a small edit — and so a price stored
                // before the selection changed cannot silently come back.
                if (e.target.checked) setPrice(computed)
              }}
            />
            abweichender Preis
          </label>

          {priceOverride && (
            <label className="field">
              Preis (EUR)
              <input
                type="number"
                className="numeral"
                value={price}
                onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </label>
          )}
        </section>
      </div>
```

- [ ] **Step 4: Replace the Detail layout CSS**

In `web/manifest/src/index.css`, replace the `.detail-grid` rule and its `@media (min-width: 900px)` block (lines 432–448) plus the `.manifest-fields` rule (lines 471–476) with:

```css
/* Detail screen: the guest reads across the top, and what the manifest actually
   decides reads as three columns under it — who flies them, what they get, what
   they pay. One 420px column of eleven fields was taller than any window while
   two thirds of a desk monitor sat empty beside it. */
.detail-screen {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-cols {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
  align-items: start;
}

/* Two columns as soon as there is room for two readable ones; the till joins
   them on a desk monitor. */
@media (min-width: 900px) {
  .detail-cols {
    grid-template-columns: repeat(2, minmax(300px, 1fr));
  }
}

@media (min-width: 1280px) {
  .detail-cols {
    grid-template-columns: minmax(300px, 1fr) minmax(300px, 1fr) minmax(300px, 380px);
  }
}

/* The back button keeps its own width instead of stretching across the strip. */
.detail-back {
  align-self: flex-start;
}
```

Then replace the `.price-box` rule (lines 584–593) with:

```css
/* The money panel is the third column. It carries no border of its own — the
   panel it sits in is the border — so the total is the only thing in it with
   weight. */
.kassa-panel .price-line {
  gap: 16px;
}
```

- [ ] **Step 5: Tag the back button**

In `web/manifest/src/Detail.tsx`, change the back button (currently `className="btn secondary"`) to:

```tsx
      <button type="button" className="btn secondary detail-back" onClick={onBack}>
        ← Zurück
      </button>
```

- [ ] **Step 6: Run the tests**

Run: `npm --prefix web/manifest run test -- Detail`

Expected: PASS — all `Detail` tests. `total()` still resolves because `.price-total .numeral` survives inside the Kassa panel, and `voucherGroup()` still resolves because the `<fieldset><legend>Gutschein</legend>` pair is unchanged.

- [ ] **Step 7: Type check**

Run: `npm --prefix web/manifest exec -- tsc -b`

Expected: no output, exit code 0.

- [ ] **Step 8: Commit**

```bash
git add web/manifest/src/index.css web/manifest/src/Detail.tsx web/manifest/src/Detail.test.tsx
git commit -m "feat(manifest): split the detail fields into assignment, service and till panels"
```

---

### Task 5: Sticky action bar, sticky till, and full verification

**Files:**
- Modify: `web/manifest/src/Detail.tsx` (the trailing `error` / `saved` / `<div className="actions">` block)
- Modify: `web/manifest/src/index.css` (append sticky rules and the reduced-motion/focus floor)
- Test: `web/manifest/src/Detail.test.tsx`

**Interfaces:**
- Consumes: `.save-bar` from Task 1, `.detail-cols` and `.kassa-panel` from Task 4.
- Produces: the finished screens. Nothing depends on this task.

- [ ] **Step 1: Write the failing test**

Add this test to `web/manifest/src/Detail.test.tsx`:

```tsx
  it('keeps every action that leaves this row in one bar', async () => {
    renderDetail()
    await screen.findByText('Zu kassieren')

    const bar = document.querySelector('.save-bar')
    expect(bar).not.toBeNull()

    const actions = within(bar as HTMLElement)
    expect(actions.getByRole('link', { name: 'Vertrag öffnen' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Urkunde drucken' })).toBeInTheDocument()
    expect(actions.getByRole('button', { name: 'Speichern' })).toBeInTheDocument()
    // Set apart from the rest so it is never the button next to Speichern.
    expect(actions.getByRole('button', { name: /Registrierung löschen/ }))
      .toHaveClass('detail-delete')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix web/manifest run test -- Detail`

Expected: FAIL — `expect(received).not.toBeNull()` on the `.save-bar` lookup.

- [ ] **Step 3: Move the actions into the sticky bar**

In `web/manifest/src/Detail.tsx`, replace the trailing block — the `{error && …}` line, the `{saved && …}` line and the whole `<div className="actions"> … </div>` — with:

```tsx
      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="save-bar detail-actions">
        <a
          className="btn secondary"
          href={contractPdfUrl(registration.id)}
          target="_blank"
          rel="noreferrer"
        >
          Vertrag öffnen
        </a>
        {/*
          The Urkunde print sheet for `registration` is rendered by App.tsx (see
          Urkunde.tsx / urkunde.css) as a sibling of the app shell, not here — it
          must sit outside the `.no-print` subtree so `@media print` can hide the
          app UI without also hiding the sheet. This button only has to trigger
          the browser print dialog.
        */}
        <button type="button" className="btn secondary" onClick={() => window.print()}>
          Urkunde drucken
        </button>
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
        {/* Set apart from the rest so it is never the button next to Speichern. */}
        <button
          type="button"
          className="btn danger detail-delete"
          onClick={handleDelete}
          disabled={deleting}
        >
          <TrashIcon />
          {deleting ? 'Löscht…' : 'Registrierung löschen'}
        </button>
      </div>
```

- [ ] **Step 4: Add the remaining CSS**

Append to `web/manifest/src/index.css`:

```css
/* Speichern sits between the two secondary actions and the delete, not at the
   far edge of the bar — `.save-bar .btn.primary { margin-left: auto }` would
   push it past them. */
.detail-actions .btn.primary {
  margin-left: 0;
}

/* Three columns, and the money is the one an operator glances back at while
   changing the other two. On a desk monitor it follows them down. */
@media (min-width: 1280px) {
  .kassa-panel {
    position: sticky;
    top: 28px;
  }
}

/* Quality floor: the tab and panel controls added here are keyboard-reachable,
   so they have to be keyboard-visible too. */
.text-tab:focus-visible,
.btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run the whole manifest suite**

Run: `npm --prefix web/manifest run test`

Expected: PASS — every test in `Betraege.test.tsx`, `Detail.test.tsx`, `List.test.tsx`, `Settings.test.tsx`, `Stammdaten.test.tsx`, `Urkunde.test.tsx`.

- [ ] **Step 6: Run the lint and type check**

Run: `npm --prefix web/manifest run lint`

Expected: `Found 0 warnings and 0 errors`.

Run: `npm --prefix web/manifest exec -- tsc -b`

Expected: no output, exit code 0.

- [ ] **Step 7: Run the root suite and build the frontends**

Run: `npm run test`

Expected: all root Vitest tests pass (server routes, pricing, config, voucher list — none of them touch these two components, so a failure here means something unrelated broke).

Run: `npm run build:web`

Expected: both Vite builds report `✓ built in …` with no TypeScript errors.

- [ ] **Step 8: Look at the result**

Run: `npm --prefix web/manifest run dev`

Open the printed URL at a 1920×1080 window and check, on both screens:

1. Einstellungen shows the whole screen with no page scrollbar — paths and backup left, one guest text right, Speichern pinned at the bottom.
2. Clicking `Vertragstext` swaps the text without moving anything else, and typing in one tab then switching and back keeps what was typed.
3. Detail shows the guest strip across the top and three panels below it, with the till column visible beside the fields.
4. Selecting `Gutschein` in Zahlungsart opens the voucher block inside the Zuteilung panel, and the columns beside it do not jump.
5. Narrow the window past 1280px and past 900px — the columns fall to two and then one without anything overlapping or overflowing sideways.
6. Switch the OS to dark mode and confirm both screens still read (all new surfaces use `--panel-bg` / `--border` / `--text-h`, which already flip).

Stop the dev server when done.

- [ ] **Step 9: Commit**

```bash
git add web/manifest/src/index.css web/manifest/src/Detail.tsx web/manifest/src/Detail.test.tsx
git commit -m "feat(manifest): pin the detail actions and the till while the fields scroll"
```

- [ ] **Step 10: Rebuild the exe**

Run: `npm run build:all`

Expected: `build:web` builds both frontends, `build:server` writes `dist/server.cjs`, `build:exe` prints `Packaging exe for node24-win-x64` and `OK: copied better_sqlite3.node -> dist\better_sqlite3.node`.

---

## Notes for the implementer

- **`.actions` stays.** Stammdaten and Betraege still use it; only Settings and Detail move to `.save-bar`.
- **Nothing about saving changes.** `handleSave`, `putSettings`, `patch`, the voucher logic, and the price computation are untouched by every task here. If a test about money or vouchers fails, the markup move broke a query, not the logic — find the query.
- **`getByLabelText` and hidden elements.** Testing Library's `getByLabelText` does not filter hidden nodes; only `*ByRole` does. That is why the inactive text tab can stay mounted with `hidden` and the pre-existing test still finds its textarea.
- **`.numeral` already sets `--mono` and `tabular-nums`** (`index.css:184`). The guest strip reuses it rather than restating the font.
