# Tarife and Crew Screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the manifest's "Stammdaten" tab into a "Tarife" tab (prices, payouts, new final-price table) and a "Crew" tab (crew lists with the add row on top).

**Architecture:** Frontend-only change in `web/manifest`. A new pure `PriceMatrix` component derives the nine final prices from the live price inputs in `Betraege` via the existing `computePrice` in `pricing.ts`. `Stammdaten.tsx` becomes `Crew.tsx` without the amounts; a thin `Tarife.tsx` hosts `Betraege`. `App.tsx` gets two tabs instead of one.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (unit), Playwright (e2e), oxlint.

Spec: `docs/superpowers/specs/2026-09-29-tarife-crew-design.md`

## Global Constraints

- Code, identifiers, comments and commit messages in English (see `CLAUDE.md`). UI text stays German.
- End every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_012EvJTAa9ojZDoaiMxKV2vJ
  ```
- No backend changes. `/stammdaten` routes and `StammdatenItem` / `StammdatenKind` in `web/manifest/src/api.ts` keep their names.
- Unit tests run from `web/manifest`: `npx vitest run <file>`. Lint: `npm run lint`. Type check + build: `npm run build`.
- Match surrounding code: comments explain *why*, in the same tone as existing ones.
- Exact UI strings: tabs `Tarife`, `Crew`; table heading `Endpreise`; columns `ohne Zuschlag`, `ab 90 kg`, `ab 100 kg`; rows `Tandem`, `Tandem + Video`, `Tandem + Video + Foto`; placeholder `Vorname Nachname`; missing value `–` (U+2013).

---

### Task 1: PriceMatrix component

**Files:**
- Create: `web/manifest/src/PriceMatrix.tsx`
- Create: `web/manifest/src/PriceMatrix.test.tsx`
- Modify: `web/manifest/src/index.css` (append styles)

**Interfaces:**
- Consumes: `computePrice(fields: PricedFields, prices: Prices): number` and `formatEuro(amount: number): string` from `./pricing`; types `ExtraBooking`, `Prices`, `WeightSurcharge` from `./api`.
- Produces: `export default function PriceMatrix({ prices }: { prices: Partial<Prices> })` — renders `<section className="price-matrix">` with `<h3>Endpreise</h3>` and a `<table>`.

- [ ] **Step 1: Write the failing test**

`web/manifest/src/PriceMatrix.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import PriceMatrix from './PriceMatrix'
import type { Prices } from './api'

const PRICES: Prices = {
  jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60,
}

// Every row as the text of its cells, header row first.
const cells = () =>
  screen.getAllByRole('row').map((row) => Array.from(row.children).map((c) => c.textContent))

describe('PriceMatrix', () => {
  it('shows the final price of every combination', () => {
    render(<PriceMatrix prices={PRICES} />)

    expect(screen.getByRole('heading', { name: 'Endpreise' })).toBeInTheDocument()
    expect(cells()).toEqual([
      ['', 'ohne Zuschlag', 'ab 90 kg', 'ab 100 kg'],
      ['Tandem', '270 €', '310 €', '330 €'],
      ['Tandem + Video', '370 €', '410 €', '430 €'],
      ['Tandem + Video + Foto', '390 €', '430 €', '450 €'],
    ])
  })

  it('blanks only the cells that need a missing price', () => {
    const { video: _video, ...withoutVideo } = PRICES
    render(<PriceMatrix prices={withoutVideo} />)

    expect(cells()).toEqual([
      ['', 'ohne Zuschlag', 'ab 90 kg', 'ab 100 kg'],
      ['Tandem', '270 €', '310 €', '330 €'],
      ['Tandem + Video', '–', '–', '–'],
      ['Tandem + Video + Foto', '390 €', '430 €', '450 €'],
    ])
  })

  it('blanks a surcharge column when its surcharge is missing', () => {
    const { weight_over_100: _w, ...withoutOver100 } = PRICES
    render(<PriceMatrix prices={withoutOver100} />)

    expect(cells().slice(1).map((row) => row[3])).toEqual(['–', '–', '–'])
    expect(cells()[1][2]).toBe('310 €')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (in `web/manifest`): `npx vitest run src/PriceMatrix.test.tsx`
Expected: FAIL — cannot resolve `./PriceMatrix`.

- [ ] **Step 3: Write the implementation**

`web/manifest/src/PriceMatrix.tsx`:

```tsx
import type { ExtraBooking, Prices, WeightSurcharge } from './api'
import { computePrice, formatEuro } from './pricing'

// Each row and column names the prices it adds, so a cell knows which inputs
// it depends on and can blank itself alone when one of them is invalid.
const ROWS: { booking: ExtraBooking; label: string; needs: (keyof Prices)[] }[] = [
  { booking: 'none', label: 'Tandem', needs: ['jump'] },
  { booking: 'video', label: 'Tandem + Video', needs: ['jump', 'video'] },
  { booking: 'video_photo', label: 'Tandem + Video + Foto', needs: ['jump', 'video_photo'] },
]

const COLUMNS: { surcharge: WeightSurcharge; label: string; needs: (keyof Prices)[] }[] = [
  { surcharge: 'none', label: 'ohne Zuschlag', needs: [] },
  { surcharge: 'over_90', label: 'ab 90 kg', needs: ['weight_over_90'] },
  { surcharge: 'over_100', label: 'ab 100 kg', needs: ['weight_over_100'] },
]

interface PriceMatrixProps {
  // Only the prices that currently parse; the rest are left out.
  prices: Partial<Prices>
}

// What a guest pays for each combination, derived with the same rule the detail
// screen uses, so the table can never disagree with an actual bill.
export default function PriceMatrix({ prices }: PriceMatrixProps) {
  function cell(booking: ExtraBooking, surcharge: WeightSurcharge, needs: (keyof Prices)[]) {
    if (needs.some((key) => prices[key] === undefined)) return '–'
    // Safe: computePrice only reads the prices listed in `needs`.
    return formatEuro(
      computePrice({ extra_booking: booking, weight_surcharge: surcharge }, prices as Prices)
    )
  }

  return (
    <section className="price-matrix">
      <h3>Endpreise</h3>
      <table>
        <thead>
          <tr>
            <td />
            {COLUMNS.map((col) => (
              <th key={col.surcharge} scope="col">{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => (
            <tr key={row.booking}>
              <th scope="row">{row.label}</th>
              {COLUMNS.map((col) => (
                <td key={col.surcharge} className="numeral">
                  {cell(row.booking, col.surcharge, [...row.needs, ...col.needs])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

Append to `web/manifest/src/index.css` (after the `.betraege-section` rules):

```css
.price-matrix {
  flex: 1;
  min-width: 260px;
}

.price-matrix table {
  border-collapse: collapse;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.price-matrix th,
.price-matrix td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  text-align: right;
  white-space: nowrap;
}

.price-matrix th[scope='row'] {
  text-align: left;
}

.price-matrix tbody tr:last-child th,
.price-matrix tbody tr:last-child td {
  border-bottom: none;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (in `web/manifest`): `npx vitest run src/PriceMatrix.test.tsx`
Expected: 3 tests PASS. If `formatEuro` output differs only by whitespace character, fix the test expectation to match `formatEuro`, not the component.

- [ ] **Step 5: Lint**

Run (in `web/manifest`): `npm run lint`
Expected: no new warnings for `PriceMatrix*`. If the unused `_video` / `_w` destructure is flagged, replace with `const withoutVideo: Partial<Prices> = { ...PRICES }; delete withoutVideo.video`.

- [ ] **Step 6: Commit**

```bash
git add web/manifest/src/PriceMatrix.tsx web/manifest/src/PriceMatrix.test.tsx web/manifest/src/index.css
git commit -m "feat(manifest): add final price table component"
```

---

### Task 2: Show the price table live in Betraege

**Files:**
- Modify: `web/manifest/src/Betraege.tsx`
- Test: `web/manifest/src/Betraege.test.tsx`

**Interfaces:**
- Consumes: `PriceMatrix` default export from Task 1 (`prices: Partial<Prices>`).
- Produces: nothing new for later tasks; `Betraege` default export unchanged.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('Beträge', ...)` in `web/manifest/src/Betraege.test.tsx`:

```tsx
  it('shows the final prices between the prices and the payout rates', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Preise (EUR)', 'Endpreise', 'Vergütung (EUR)'])
    expect(screen.getByRole('rowheader', { name: 'Tandem' }).parentElement).toHaveTextContent(
      'Tandem270 €310 €330 €'
    )
  })

  it('updates the final prices while typing, before saving', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await userEvent.clear(field('Tandemsprung'))
    await userEvent.type(field('Tandemsprung'), '300')

    expect(screen.getByRole('rowheader', { name: 'Tandem' }).parentElement).toHaveTextContent(
      'Tandem300 €340 €360 €'
    )
    expect(api.putSettings).not.toHaveBeenCalled()
  })

  it('blanks the final prices a typo would break', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await userEvent.clear(field('Video'))

    expect(screen.getByRole('rowheader', { name: 'Tandem + Video' }).parentElement).toHaveTextContent(
      'Tandem + Video–––'
    )
    expect(screen.getByRole('rowheader', { name: 'Tandem' }).parentElement).toHaveTextContent(
      'Tandem270 €310 €330 €'
    )
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run (in `web/manifest`): `npx vitest run src/Betraege.test.tsx`
Expected: the three new tests FAIL (no `Endpreise` heading / no rowheader); existing tests PASS.

- [ ] **Step 3: Implement**

In `web/manifest/src/Betraege.tsx`:

1. Add import: `import PriceMatrix from './PriceMatrix'`.
2. Replace the body of `toAmounts` validation with a shared parser. Add above `toAmounts`:

```tsx
// null for anything that would silently save as 0 € — empty, not a number, or
// negative. Shared by saving (which refuses) and the live table (which blanks).
function parseAmount(raw: string): number | null {
  const value = Number(raw)
  return raw.trim() === '' || !Number.isFinite(value) || value < 0 ? null : value
}
```

and change the loop in `toAmounts` to:

```tsx
  for (const { key, label } of fields) {
    const value = parseAmount(inputs[key])
    if (value === null) {
      throw new Error(`${noun} „${label}" ungültig`)
    }
    out[key] = value as T[keyof T]
  }
```

3. Add below `toInputs`:

```tsx
// The prices as typed right now, minus the ones that do not parse. Feeds the
// final price table, which shows what saving would charge.
function livePrices(inputs: Record<keyof Prices, string>): Partial<Prices> {
  const out: Partial<Prices> = {}
  for (const { key } of PRICE_FIELDS) {
    const value = parseAmount(inputs[key])
    if (value !== null) out[key] = value
  }
  return out
}
```

4. In the JSX, between the `Preise (EUR)` `<AmountFields … />` and the `Vergütung (EUR)` one, insert:

```tsx
      <PriceMatrix prices={livePrices(priceInputs)} />
```

5. Update the comment above `export default function Betraege()` to:

```tsx
// Prices and payout rates, edited together: both are per-jump amounts the club
// sets once a season. Lives on the Tarife screen, apart from the directory
// settings.
```

- [ ] **Step 4: Run tests to verify they pass**

Run (in `web/manifest`): `npx vitest run src/Betraege.test.tsx src/PriceMatrix.test.tsx`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add web/manifest/src/Betraege.tsx web/manifest/src/Betraege.test.tsx
git commit -m "feat(manifest): show live final prices between prices and payouts"
```

---

### Task 3: Split the tab into Tarife and Crew

**Files:**
- Rename: `web/manifest/src/Stammdaten.tsx` → `web/manifest/src/Crew.tsx` (use `git mv`)
- Rename: `web/manifest/src/Stammdaten.test.tsx` → `web/manifest/src/Crew.test.tsx` (use `git mv`)
- Create: `web/manifest/src/Tarife.tsx`
- Modify: `web/manifest/src/App.tsx` (import line 4, `View` type line 17, tabs ~lines 181-187, render ~line 237)
- Modify: `web/manifest/src/App.test.tsx:60`
- Modify: `web/manifest/src/index.css` (Stammdaten/Betraege section, ~lines 1000-1060)
- Modify: `web/manifest/src/Settings.tsx:61-62`, `web/manifest/src/Settings.tsx:238-239`
- Modify: `web/manifest/src/Settings.test.tsx:265-269`
- Modify: `web/manifest/src/date.ts:19`
- Modify: `tests/e2e/manifest-texts-and-date.spec.ts:70`
- Modify: `tests/e2e/price-per-day.spec.ts:51-54`

**Interfaces:**
- Consumes: `Betraege` default export (Task 2); `addFlyer`, `addMaster`, `deleteFlyer`, `deleteMaster`, `flyers`, `masters`, `StammdatenItem` from `./api` (unchanged).
- Produces: `export default function Crew()`, `export default function Tarife()`; `View = 'list' | 'detail' | 'tarife' | 'crew' | 'settings' | 'update'`.

- [ ] **Step 1: Rename files**

```bash
git mv web/manifest/src/Stammdaten.tsx web/manifest/src/Crew.tsx
git mv web/manifest/src/Stammdaten.test.tsx web/manifest/src/Crew.test.tsx
```

- [ ] **Step 2: Write the failing Crew test**

Replace the whole content of `web/manifest/src/Crew.test.tsx` with:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Crew from './Crew'
import * as api from './api'

vi.mock('./api', () => ({
  masters: vi.fn(),
  flyers: vi.fn(),
  addMaster: vi.fn(),
  addFlyer: vi.fn(),
  deleteMaster: vi.fn(),
  deleteFlyer: vi.fn(),
}))

describe('Crew', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.masters).mockResolvedValue([{ id: 1, name: 'Hans' }])
    vi.mocked(api.flyers).mockResolvedValue([{ id: 7, name: 'Peter' }])
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
})
```

- [ ] **Step 3: Run test to verify it fails**

Run (in `web/manifest`): `npx vitest run src/Crew.test.tsx`
Expected: FAIL (Crew.tsx still exports `Stammdaten` rendering `Betraege`, placeholder wrong; `getSettings` not mocked).

- [ ] **Step 4: Rewrite Crew.tsx**

Replace the whole content of `web/manifest/src/Crew.tsx` with:

```tsx
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
import TrashIcon from './TrashIcon'

interface CrewListProps {
  title: string
  load: () => Promise<StammdatenItem[]>
  add: (name: string) => Promise<{ id: number }>
  remove: (id: number) => Promise<void>
}

function CrewList({ title, load, add, remove }: CrewListProps) {
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
        <button type="button" className="btn primary" onClick={handleAdd} disabled={busy || !name.trim()}>
          Hinzufügen
        </button>
      </div>
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
    </section>
  )
}

export default function Crew() {
  return (
    <div className="crew-screen">
      <CrewList title="Tandemmaster" load={fetchMasters} add={addMaster} remove={deleteMaster} />
      <CrewList title="Kameraflieger" load={fetchFlyers} add={addFlyer} remove={deleteFlyer} />
    </div>
  )
}
```

- [ ] **Step 5: Create Tarife.tsx**

`web/manifest/src/Tarife.tsx`:

```tsx
import Betraege from './Betraege'

// Prices, payout rates and what they add up to. Opened before every season and
// whenever someone asks what a combination costs; the crew lists change on
// their own schedule and live on the Crew screen.
export default function Tarife() {
  return (
    <div className="tarife-screen">
      <Betraege />
    </div>
  )
}
```

- [ ] **Step 6: Wire the tabs in App.tsx**

In `web/manifest/src/App.tsx`:

- Replace `import Stammdaten from './Stammdaten'` with:
  ```tsx
  import Crew from './Crew'
  import Tarife from './Tarife'
  ```
  (keep imports in the file's existing order style).
- Replace `type View = 'list' | 'detail' | 'stammdaten' | 'settings' | 'update'` with
  `type View = 'list' | 'detail' | 'tarife' | 'crew' | 'settings' | 'update'`.
- Replace the Stammdaten tab button with two buttons:
  ```tsx
          <button
            type="button"
            className={view === 'tarife' ? 'tab active' : 'tab'}
            onClick={() => setView('tarife')}
          >
            Tarife
          </button>
          <button
            type="button"
            className={view === 'crew' ? 'tab active' : 'tab'}
            onClick={() => setView('crew')}
          >
            Crew
          </button>
  ```
- Replace `{view === 'stammdaten' && <Stammdaten />}` with:
  ```tsx
          {view === 'tarife' && <Tarife />}
          {view === 'crew' && <Crew />}
  ```
- Run `grep -n "stammdaten\|Stammdaten" web/manifest/src/App.tsx` — expected: no output.

- [ ] **Step 7: Update CSS**

In `web/manifest/src/index.css`, replace the block from `/* Stammdaten screen */` through the `.betraege-section > .hint { flex-basis: 100%; }` rule with:

```css
/* Crew screen */
.crew-screen {
  display: flex;
  gap: 32px;
  flex-wrap: wrap;
}

.crew-list {
  flex: 1;
  min-width: 260px;
}

.crew-list .add-row {
  margin-bottom: 12px;
}

.crew-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-bg);
}

.crew-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}

.crew-list li:last-child {
  border-bottom: none;
}

/* Tarife screen: prices, final prices and payouts side by side where the
   window allows, stacked on a narrow one. */
.betraege-section {
  display: flex;
  flex-wrap: wrap;
  gap: 32px;
}

.betraege-section .amount-block {
  flex: 1;
  min-width: 260px;
}

.betraege-section .field {
  max-width: 340px;
  margin-bottom: 12px;
}

/* The save button belongs to all blocks, so it breaks onto its own row. */
.betraege-section .actions,
.betraege-section > .error,
.betraege-section > .hint {
  flex-basis: 100%;
}
```

Keep the `.price-matrix` rules from Task 1 and the `.add-row` rules unchanged. Then run
`grep -rn "stammdaten-" web/manifest/src` — expected: no output.

- [ ] **Step 8: Update the remaining references**

- `web/manifest/src/App.test.tsx:60`: `name: 'Stammdaten'` → `name: 'Crew'`.
- `web/manifest/src/Settings.tsx:61-62` comment →
  ```tsx
  // Where the manifest writes and what it prints on a contract. The amounts it
  // charges and pays out live on the Tarife screen.
  ```
- `web/manifest/src/Settings.tsx:238-239` comment →
  ```tsx
      // The server merges the price and payout blocks, so leaving them out here
      // keeps whatever the Tarife screen saved.
  ```
- `web/manifest/src/Settings.test.tsx:265`: test name → `'leaves the amounts to the Tarife screen'`; its comment (lines 269-270) →
  ```tsx
      // Prices and payout rates have their own screen; a second editor here
      // would let two screens overwrite each other.
  ```
- `web/manifest/src/date.ts:19`: `unmounted by every trip to Stammdaten, Einstellungen or a registration's` → `unmounted by every trip to Tarife, Crew, Einstellungen or a registration's` (re-wrap the comment line if it gets over ~80 chars).
- `tests/e2e/manifest-texts-and-date.spec.ts:70`: `name: 'Stammdaten'` → `name: 'Crew'`.
- `tests/e2e/price-per-day.spec.ts:51`: comment → `// The prices live on the Tarife screen.`; line 54: `name: 'Stammdaten'` → `name: 'Tarife'`.
- Run `grep -rn "Stammdaten" web/manifest/src tests --include=*.ts --include=*.tsx | grep -v "StammdatenItem\|StammdatenKind"` — expected: no output.

- [ ] **Step 9: Run all manifest unit tests, lint, build**

Run (in `web/manifest`):
```bash
npx vitest run
npm run lint
npm run build
```
Expected: all tests PASS, lint clean, build succeeds (TypeScript catches any leftover `'stammdaten'` view).

- [ ] **Step 10: Run affected e2e specs**

Run (repo root): `npx playwright test tests/e2e/manifest-texts-and-date.spec.ts tests/e2e/price-per-day.spec.ts`
Expected: PASS. If Playwright needs a fresh web build first, run `npm run build:web` at the root and retry. If browsers are not installed, report that instead of skipping silently.

- [ ] **Step 11: Commit**

```bash
git add -A web/manifest/src tests/e2e
git commit -m "feat(manifest): split Stammdaten into Tarife and Crew tabs

Tarife holds prices, final price table and payouts; Crew holds the
tandem master and camera flyer lists with the add field on top."
```
