# Übergewichts-Zuschlag in der Tandemmaster-Vergütung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tandem master earns an extra 15,00 € for a guest from 90 kg and 25,00 € from 100 kg, both configurable in the Stammdaten screen and visible in the daily Excel export.

**Architecture:** Two new amounts in the existing `Config.payouts` block, which is already validated, merged, persisted and frozen per jump day by machinery that needs no change. `payoutSections` records the bonus as one more `Tally` inside the master's existing calculation string, keyed off the row's stored `weight_surcharge` field. Jump days frozen before this change fall back to 0 € for exactly these two amounts, so a re-export of an old day still matches the sheet the club already settled.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, ExcelJS, Vitest (server), React + Vite + Vitest/jsdom + Testing Library (manifest UI).

## Global Constraints

- Source of truth for the bonus is the row's stored `weight_surcharge` enum (`none` / `over_90` / `over_100`), **never** `weight_kg`. Waiving the guest surcharge waives the master's bonus with it.
- New payout keys are named `weight_over_90` and `weight_over_100`, mirroring the existing `Prices` keys of the same name. Defaults: `15` and `25`.
- A bonus rate of `0` must record no tally at all — no `× 0,00 €` lines in any sheet.
- Comments in this codebase are written in English on the server and explain *why*, not *what*. German is used for user-facing strings and for the spec/plan documents. Match the surrounding file.
- Server tests: `npm test` (vitest, repo root). Manifest tests: `npm --prefix web/manifest run test`.
- Do not touch `Prices`, `surchargeForWeight`, the guest app, or the camera-flyer payout rule.

---

### Task 1: The two payout amounts exist and are configurable

Adds the amounts to `Payouts`, `PAYOUT_KEYS` and `DEFAULT_PAYOUTS`. `routes/settings.ts` and `loadConfig` iterate those lists, so validation, key-wise merging and the config.json migration come for free — the tests here pin exactly that. Two existing settings tests assert the *whole* payouts object and will fail until they name the new keys; fixing them is part of this task.

**Files:**
- Modify: `src/server/config.ts` (interface `Payouts`, `PAYOUT_KEYS`, `DEFAULT_PAYOUTS`)
- Modify: `config.example.json`
- Test: `tests/config.test.ts`, `tests/settings.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Payouts.weight_over_90: number`, `Payouts.weight_over_100: number`; `DEFAULT_PAYOUTS = { tandem_master: 45, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25 }`. Tasks 2, 3 and 5 read these.

- [ ] **Step 1: Write the failing tests**

Append to `tests/config.test.ts`, after the test `'a partial payout block keeps the stored rates and fills the rest'`:

```ts
test('the payout defaults carry the tandemmaster weight bonus', async () => {
  const dir = await makeDir()
  const cfg = loadConfig(dir)
  expect(cfg.payouts.weight_over_90).toBe(15)
  expect(cfg.payouts.weight_over_100).toBe(25)
})

test('a payout block written before the weight bonus existed gains it', async () => {
  const dir = await makeDir({ payouts: { tandem_master: 50, video: 60, video_photo: 80 } })
  const cfg = loadConfig(dir)
  expect(cfg.payouts.tandem_master).toBe(50)
  expect(cfg.payouts.weight_over_90).toBe(15)
  expect(cfg.payouts.weight_over_100).toBe(25)
})
```

In `tests/settings.test.ts`, replace the body of the two tests that name the whole block. First, `'get settings exposes the payout rates'` — the expectation line becomes:

```ts
  expect(res.json().payouts).toEqual({
    tandem_master: 45, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
  })
```

Then `'put settings stores new payout rates'` — the `payload` and the expectation become:

```ts
    payload: {
      payouts: {
        tandem_master: 50, video: 65, video_photo: 85,
        weight_over_90: 20, weight_over_100: 30,
      },
    },
  })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.payouts).toEqual({
    tandem_master: 50, video: 65, video_photo: 85, weight_over_90: 20, weight_over_100: 30,
  })
```

And append this new test to `tests/settings.test.ts`, after `'put settings rejects a non-numeric or negative payout rate'`:

```ts
test('put settings rejects a negative weight bonus and keeps the stored one', async () => {
  const { app, cfgRef } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings', payload: { payouts: { weight_over_90: -1 } },
  })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('Vergütung weight_over_90 ungültig')
  expect(cfgRef.current.payouts.weight_over_90).toBe(15)
  await app.close()
})

test('a client that sends only tandem_master does not wipe the weight bonus', async () => {
  const { app, cfgRef } = testServer()
  await app.inject({
    method: 'PUT', url: '/api/settings', payload: { payouts: { tandem_master: 50 } },
  })
  expect(cfgRef.current.payouts.weight_over_100).toBe(25)
  await app.close()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/config.test.ts tests/settings.test.ts`

Expected: FAIL. The config tests report `expected undefined to be 15`; the settings tests report an object mismatch on the missing `weight_over_90` / `weight_over_100` keys.

- [ ] **Step 3: Add the amounts to the config**

In `src/server/config.ts`, replace the `Payouts` block (interface, keys, defaults) with:

```ts
// What the club pays out per jump, in EUR. Separate from `Prices` because these
// amounts never touch what a guest owes — they are the club's side of the day.
// The two weight amounts are what the master gets on top for flying the heavier
// guest; they carry the same names as their counterparts in `Prices`, because
// they are triggered by the same `weight_surcharge` on the row.
export interface Payouts {
  tandem_master: number
  video: number
  video_photo: number
  weight_over_90: number
  weight_over_100: number
}

export const PAYOUT_KEYS = [
  'tandem_master', 'video', 'video_photo', 'weight_over_90', 'weight_over_100',
] as const

export const DEFAULT_PAYOUTS: Payouts = {
  tandem_master: 45,
  video: 60,
  video_photo: 80,
  weight_over_90: 15,
  weight_over_100: 25,
}
```

In `config.example.json`, replace the `payouts` block with:

```json
  "payouts": {
    "tandem_master": 45,
    "video": 60,
    "video_photo": 80,
    "weight_over_90": 15,
    "weight_over_100": 25
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/config.test.ts tests/settings.test.ts`
Expected: PASS, all tests in both files.

- [ ] **Step 5: Run the whole server suite**

Run: `npm test`

Expected: PASS. If `tests/dayTables.test.ts` or `tests/export.test.ts` fail here, they are asserting an old payouts shape — read the failure and fix the assertion to name the new keys, do **not** change the defaults.

- [ ] **Step 6: Commit**

```bash
git add src/server/config.ts config.example.json tests/config.test.ts tests/settings.test.ts
git commit -m "feat(verguetung): Zuschlagsbeträge für den Tandemmaster in der Konfiguration"
```

---

### Task 2: A day frozen before the bonus existed pays none of it

`day_tables` snapshots the payout rates on a day's first registration. `parse` spreads a stored snapshot over the *current* config so that an old or incomplete snapshot cannot leave an amount `undefined`. For these two new amounts that same rule would pay a bonus retroactively on days flown before the feature existed. They therefore fall back to `0` for frozen days only.

**Files:**
- Modify: `src/server/dayTables.ts` (add `PAYOUTS_BEFORE`, use it in `parse`)
- Test: `tests/dayTables.test.ts`

**Interfaces:**
- Consumes: `Payouts` and `DEFAULT_PAYOUTS` from Task 1.
- Produces: `tablesForDay(db, jumpDate, cfg).payouts.weight_over_90` is `0` for a snapshot that does not name it, and the stored number for one that does.

- [ ] **Step 1: Write the failing test**

At the top of `tests/dayTables.test.ts`, extend the existing imports with these two lines:

```ts
import { openDb } from '../src/server/db'
import { tablesForDay } from '../src/server/dayTables'
```

Append to the end of `tests/dayTables.test.ts`:

```ts
// A snapshot written before the weight bonus existed does not name it. Spreading
// it over today's config — which is what makes an incomplete snapshot safe for
// every other amount — would make a re-export of that day pay a bonus nobody
// agreed to and nobody handed over.
test('a day frozen before the weight bonus existed pays none of it', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO day_tables (jump_date, prices, payouts) VALUES (?,?,?)').run(
    '2026-08-01',
    JSON.stringify(DEFAULT_PRICES),
    JSON.stringify({ tandem_master: 45, video: 60, video_photo: 80 }),
  )
  const cfg = { prices: DEFAULT_PRICES, payouts: DEFAULT_PAYOUTS } as any

  const tables = tablesForDay(db, '2026-08-01', cfg)

  expect(tables.payouts.weight_over_90).toBe(0)
  expect(tables.payouts.weight_over_100).toBe(0)
  // Every other amount still falls back to today's config, as before.
  expect(tables.payouts.tandem_master).toBe(45)
  expect(tables.prices).toEqual(DEFAULT_PRICES)
})

test('a snapshot that names the weight bonus keeps its own amounts', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO day_tables (jump_date, prices, payouts) VALUES (?,?,?)').run(
    '2026-08-02',
    JSON.stringify(DEFAULT_PRICES),
    JSON.stringify({ ...DEFAULT_PAYOUTS, weight_over_90: 20 }),
  )
  const cfg = { prices: DEFAULT_PRICES, payouts: DEFAULT_PAYOUTS } as any

  expect(tablesForDay(db, '2026-08-02', cfg).payouts.weight_over_90).toBe(20)
})

test('a day with no snapshot at all is quoted at today rates, bonus included', () => {
  const db = openDb(':memory:')
  const cfg = { prices: DEFAULT_PRICES, payouts: DEFAULT_PAYOUTS } as any

  expect(tablesForDay(db, '2026-08-03', cfg).payouts.weight_over_90).toBe(15)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/dayTables.test.ts`

Expected: FAIL on the first new test with `expected 15 to be 0` — the snapshot currently inherits today's bonus.

- [ ] **Step 3: Add the fallback**

In `src/server/dayTables.ts`, directly above `function parse(...)`, add:

```ts
// Amounts that did not exist when older snapshots were written. A frozen day that
// does not name them was flown without them, so they fall back to nothing rather
// than to whatever the settings say today — a re-export of a settled day has to
// keep matching the sheet the club already handed out.
const PAYOUTS_BEFORE: Partial<Payouts> = { weight_over_90: 0, weight_over_100: 0 }
```

Then change the `payouts` line inside `parse` to spread it between the fallback and the stored snapshot:

```ts
    payouts: { ...fallback.payouts, ...PAYOUTS_BEFORE, ...safeParse(row.payouts) },
```

`prices` is left exactly as it is. `currentOf` is untouched, so a day being frozen now still stores the real amounts.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/dayTables.test.ts`
Expected: PASS, including the pre-existing tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/server/dayTables.ts tests/dayTables.test.ts
git commit -m "fix(verguetung): eingefrorene Sprungtage ohne Zuschlagsbeträge zahlen keinen"
```

---

### Task 3: The bonus is paid, as one more rate in the master's calculation

`payoutSections` already handles a person collecting several rates: `record()` keeps a `Tally` per rate key, and `order` fixes their sequence in the rendered string. The bonus is one more such rate, so the master's day total stays a single line and a single number.

**Files:**
- Modify: `src/server/payouts.ts` (`PaidRow`, the loop in `payoutSections`)
- Test: `tests/payouts.test.ts`

**Interfaces:**
- Consumes: `Payouts.weight_over_90` / `weight_over_100` from Task 1.
- Produces: `payoutSections(rows, masterNames, flyerNames, payouts)` unchanged in signature; `PaidRow` gains `weight_surcharge?: string | null`. Rendered calculation reads `"3 × 45,00 € + 1 × 15,00 € + 1 × 25,00 €"`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/payouts.test.ts`:

```ts
test('an overweight guest earns the tandemmaster the bonus on top of the jump', () => {
  const section = masterSection([jump(), jump({ weight_surcharge: 'over_90' })])
  expect(section?.entries).toEqual([
    { name: 'Seiberl Markus', calculation: '2 × 45,00 € + 1 × 15,00 €', amount: 105 },
  ])
  expect(section?.total).toBe(105)
})

test('the rates keep their order — jump, then 90 kg, then 100 kg', () => {
  const section = masterSection([
    jump({ weight_surcharge: 'over_100' }),
    jump({ weight_surcharge: 'over_90' }),
    jump(),
  ])
  expect(section?.entries[0].calculation).toBe('3 × 45,00 € + 1 × 15,00 € + 1 × 25,00 €')
  expect(section?.entries[0].amount).toBe(175)
})

test('a waived surcharge pays the master nothing extra', () => {
  // The manifest can set the field back to 'none' as an exception for the guest.
  // The bonus follows that decision, not the weight on the row.
  const section = masterSection([jump({ weight_surcharge: 'none', weight_kg: 95 })])
  expect(section?.entries[0].calculation).toBe('1 × 45,00 €')
  expect(section?.total).toBe(45)
})

test('a bonus rate of 0 adds no line to the calculation', () => {
  // A club that pays no bonus — and every day flown before the bonus existed —
  // would otherwise collect "× 0,00 €" lines that say nothing.
  const section = payoutSections(
    [jump({ weight_surcharge: 'over_90' }), jump({ weight_surcharge: 'over_100' })],
    MASTERS, FLYERS,
    { ...DEFAULT_PAYOUTS, weight_over_90: 0, weight_over_100: 0 },
  ).find(s => s.title.includes('Tandemmaster'))
  expect(section?.entries[0].calculation).toBe('2 × 45,00 €')
  expect(section?.total).toBe(90)
})

test('an unassigned jump carries its bonus into the ohne-Tandemmaster line', () => {
  const section = masterSection([
    jump({ tandem_master_id: null, weight_surcharge: 'over_100' }),
  ])
  expect(section?.entries).toEqual([
    { name: 'ohne Tandemmaster', calculation: '1 × 45,00 € + 1 × 25,00 €', amount: 70 },
  ])
})

test('the bonus reaches the master even when the guest flew on a voucher', () => {
  // A voucher never covers the weight surcharge, and the payout follows the jump
  // that was flown either way.
  const section = masterSection([
    jump({
      weight_surcharge: 'over_90',
      payment_method: 'voucher', voucher_service: 'jump', price: 40,
    }),
  ])
  expect(section?.entries[0].amount).toBe(60)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- tests/payouts.test.ts`

Expected: FAIL on the first new test with the calculation being `'2 × 45,00 €'` and the amount `90` — no bonus is recorded yet.

- [ ] **Step 3: Record the bonus**

In `src/server/payouts.ts`, add the field to `PaidRow`:

```ts
export interface PaidRow {
  tandem_master_id?: number | null
  camera_flyer_id?: number | null
  extra_booking?: string | null
  weight_surcharge?: string | null
}
```

Then, inside the `for (const row of rows)` loop of `payoutSections`, insert the bonus **between** the existing `record(masters, ...)` call and the `if (row.extra_booking !== 'video' ...) continue` line:

```ts
    record(masters, master, 'jump', 0, payouts.tandem_master)

    // The heavier guest is the master's jump to fly, so the club's surcharge for
    // it reaches the person who flew it. Read from the stored field rather than
    // from the weight: the manifest waives that field as an exception, and a
    // waiver the guest gets but the payout ignores is two answers to one question.
    // A rate of 0 records nothing — a club that pays no bonus, and every day
    // frozen before the bonus existed, would otherwise collect "× 0,00 €" lines.
    if (row.weight_surcharge === 'over_90' && payouts.weight_over_90 > 0) {
      record(masters, master, 'over_90', 1, payouts.weight_over_90)
    } else if (row.weight_surcharge === 'over_100' && payouts.weight_over_100 > 0) {
      record(masters, master, 'over_100', 2, payouts.weight_over_100)
    }

    // The rate follows the service actually flown, so a video paid for by a voucher
    // counts exactly like one booked and paid today.
    if (row.extra_booking !== 'video' && row.extra_booking !== 'video_photo') continue
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/payouts.test.ts`
Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/server/payouts.ts tests/payouts.test.ts
git commit -m "feat(verguetung): Tandemmaster bekommt den Übergewichts-Zuschlag ausbezahlt"
```

---

### Task 4: The longer calculation fits in the export

The workbook writes the calculation as text and needs no structural change, but the payout block's middle column is sized `30` and a calculation carrying both bonuses is around 38 characters — it would be clipped in the sheet the block exists to make checkable.

**Files:**
- Modify: `src/server/excel.ts:64` (`PAYOUT_COLUMN_WIDTHS`)
- Test: `tests/export.test.ts`

**Interfaces:**
- Consumes: the calculation strings produced in Task 3.
- Produces: nothing other tasks read.

- [ ] **Step 1: Write the failing test**

Append to `tests/export.test.ts`. It follows the shape of the existing test `'POST /api/export appends what each tandemmaster and camera flyer earned'` — read that one first for the imports and helpers (`openDb`, `Fastify`, `registerExportRoutes`, `makeTmpDir`, `makeCfgRef`, `ExcelJS`, `path`) it already brings into the file.

```ts
test('POST /api/export pays the tandemmaster the weight bonus in the same line', async () => {
  const db = openDb(':memory:')
  const date = '2026-09-02'
  const hans = db.prepare('INSERT INTO tandem_masters (name,active) VALUES (?,1)')
    .run('Hans').lastInsertRowid
  const insert = db.prepare(`INSERT INTO registrations
    (first_name,last_name,age,weight_kg,street,postal_code,city,email,phone,
     accepted_terms,price,payment_method,extra_booking,weight_surcharge,
     tandem_master_id,camera_flyer_id,created_at,jump_date)
    VALUES (?,'B',30,?,'X 1','4240','Freistadt','a@b.de','0660',1,?,'cash','none',?,?,null,?,?)`)
  const now = new Date().toISOString()
  insert.run('Eins', 80, 270, 'none', hans, now, date)
  insert.run('Zwei', 95, 310, 'over_90', hans, now, date)
  insert.run('Drei', 105, 330, 'over_100', hans, now, date)

  const dir = await makeTmpDir()
  const app = Fastify()
  registerExportRoutes(app, db, makeCfgRef(dir))

  await app.inject({ method: 'POST', url: `/api/export?date=${date}` })

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path.join(dir, `Tandem_${date}.xlsx`))
  const ws = wb.worksheets[0]
  const lines: [any, any, any][] = []
  ws.eachRow(r => lines.push([r.getCell(1).value, r.getCell(2).value, r.getCell(3).value]))

  expect(lines).toContainEqual(['Hans', '3 × 45,00 € + 1 × 15,00 € + 1 × 25,00 €', 175])

  // The guest rows still say where those amounts came from. The Zuschlag column
  // is far to the right, so this reads whole rows rather than the first three
  // cells the payout block uses. `r.values` is 1-based with a hole at index 0.
  const allCells: any[][] = []
  ws.eachRow(r => allCells.push((r.values as any[]).slice(1)))
  expect(allCells.some(c => c.includes('ab 90 kg'))).toBe(true)
  expect(allCells.some(c => c.includes('ab 100 kg'))).toBe(true)
  // …and the column holding the calculation is wide enough to show all of it.
  expect(ws.getColumn(2).width).toBeGreaterThanOrEqual(40)

  await app.close()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/export.test.ts`

Expected: FAIL on `expected 30 to be greater than or equal to 40`. The `'Hans'` line should already pass — Task 3 produces it.

- [ ] **Step 3: Widen the column**

In `src/server/excel.ts`, update the constant and its comment:

```ts
// The payout block writes name / calculation / amount into the first three
// columns. Those hold guest data in the rows above, which is narrower than a
// calculation like "3 × 45,00 € + 1 × 15,00 € + 1 × 25,00 €" — the columns are
// widened to fit both rather than clipping the arithmetic the block exists to show.
const PAYOUT_COLUMN_WIDTHS = [26, 40, 14]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- tests/export.test.ts`
Expected: PASS, including the pre-existing payout test.

- [ ] **Step 5: Run the whole server suite**

Run: `npm test`
Expected: PASS, every file.

- [ ] **Step 6: Commit**

```bash
git add src/server/excel.ts tests/export.test.ts
git commit -m "feat(export): Zuschlags-Rechnung des Tandemmasters passt in die Spalte"
```

---

### Task 5: The amounts are editable in the Stammdaten screen

`Betraege` renders both amount blocks from a field list and validates every field the list names, so this is two entries plus the two keys in the state objects the list is indexed against.

**Files:**
- Modify: `web/manifest/src/api.ts:52-56` (interface `Payouts`)
- Modify: `web/manifest/src/Betraege.tsx` (`PAYOUT_FIELDS`, `EMPTY_PAYOUTS`, `payoutInputs` initial state)
- Test: `web/manifest/src/Betraege.test.tsx`

**Interfaces:**
- Consumes: the server contract from Task 1 — `payouts.weight_over_90` and `payouts.weight_over_100` are accepted and returned by `PUT /api/settings`.
- Produces: nothing other tasks read.

- [ ] **Step 1: Write the failing tests**

In `web/manifest/src/Betraege.test.tsx`, extend the `payouts` line of the `CONFIG` fixture:

```ts
  payouts: {
    tandem_master: 45, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
  },
```

The existing test `'saves both blocks together'` asserts the whole sent block; update its expectation to:

```ts
    expect(sent.payouts).toEqual({
      tandem_master: 50, video: 60, video_photo: 80, weight_over_90: 15, weight_over_100: 25,
    })
```

Then append this test inside the `describe('Beträge', ...)` block:

```ts
  it('shows and saves the tandemmaster weight bonus', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    expect(field('Tandemmaster Zuschlag ab 90 kg').value).toBe('15')
    expect(field('Tandemmaster Zuschlag ab 100 kg').value).toBe('25')

    await userEvent.clear(field('Tandemmaster Zuschlag ab 100 kg'))
    await userEvent.type(field('Tandemmaster Zuschlag ab 100 kg'), '30')
    await userEvent.click(save())

    await waitFor(() => expect(api.putSettings).toHaveBeenCalled())
    const sent = vi.mocked(api.putSettings).mock.calls[0][0]
    expect(sent.payouts?.weight_over_100).toBe(30)
    expect(sent.payouts?.weight_over_90).toBe(15)
  })

  it('refuses to save an empty weight bonus', async () => {
    render(<Betraege />)
    await screen.findByText('Preise (EUR)')

    await userEvent.clear(field('Tandemmaster Zuschlag ab 90 kg'))
    await userEvent.click(save())

    expect(await screen.findByText('Vergütung „Tandemmaster Zuschlag ab 90 kg" ungültig'))
      .toBeInTheDocument()
    expect(api.putSettings).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix web/manifest run test`

Expected: FAIL — `Unable to find a label with the text of: Tandemmaster Zuschlag ab 90 kg`, plus a TypeScript complaint about the two unknown keys on `Payouts` in the fixture.

- [ ] **Step 3: Add the keys to the client type**

In `web/manifest/src/api.ts`, replace the `Payouts` interface:

```ts
export interface Payouts {
  tandem_master: number
  video: number
  video_photo: number
  weight_over_90: number
  weight_over_100: number
}
```

- [ ] **Step 4: Add the two fields to the screen**

In `web/manifest/src/Betraege.tsx`, extend `PAYOUT_FIELDS`:

```ts
// What the club pays out per jump. Separate from the prices above: these amounts
// leave the till, they never reach the guest.
const PAYOUT_FIELDS: { key: keyof Payouts; label: string }[] = [
  { key: 'tandem_master', label: 'Tandemmaster pro Sprung' },
  { key: 'video', label: 'Kameraflieger Video' },
  { key: 'video_photo', label: 'Kameraflieger Video + Foto' },
  { key: 'weight_over_90', label: 'Tandemmaster Zuschlag ab 90 kg' },
  { key: 'weight_over_100', label: 'Tandemmaster Zuschlag ab 100 kg' },
]
```

`EMPTY_PAYOUTS`:

```ts
const EMPTY_PAYOUTS: Payouts = {
  tandem_master: 0, video: 0, video_photo: 0, weight_over_90: 0, weight_over_100: 0,
}
```

And the initial state inside the component:

```ts
  const [payoutInputs, setPayoutInputs] = useState<Record<keyof Payouts, string>>({
    tandem_master: '', video: '', video_photo: '', weight_over_90: '', weight_over_100: '',
  })
```

Nothing else changes: `toAmounts` and `toInputs` both walk `PAYOUT_FIELDS`, so the new fields are loaded, validated and saved by the code that is already there.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm --prefix web/manifest run test`
Expected: PASS, every test in the manifest suite.

- [ ] **Step 6: Type-check the manifest build**

Run: `npm --prefix web/manifest run build`
Expected: `tsc -b` reports no errors and vite writes `dist/`. `dist/` is gitignored — it is built for the packaged exe, not committed.

- [ ] **Step 7: Commit**

```bash
git add web/manifest/src/api.ts web/manifest/src/Betraege.tsx web/manifest/src/Betraege.test.tsx
git commit -m "feat(stammdaten): Zuschlagsbeträge des Tandemmasters im Beträge-Block"
```

---

### Task 6: Final verification

**Files:** none modified unless a failure turns one up.

- [ ] **Step 1: Run the server suite**

Run: `npm test`
Expected: PASS, no skipped files.

- [ ] **Step 2: Run the manifest suite**

Run: `npm --prefix web/manifest run test`
Expected: PASS.

- [ ] **Step 3: Run the guest suite, which must be unaffected**

Run: `npm --prefix web/guest run test`
Expected: PASS. This feature touches nothing in the guest app; a failure here means something leaked.

- [ ] **Step 4: Type-check the server build**

Run: `npx tsc --noEmit`
Expected: no output.

- [ ] **Step 5: Report**

State which suites ran and their results. Do not claim completion without pasting the actual pass/fail lines.
