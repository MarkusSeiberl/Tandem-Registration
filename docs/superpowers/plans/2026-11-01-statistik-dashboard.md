# Statistik: Yearly Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new "Statistik" page in the manifest that reads as the club's yearly report (Jahresbericht). It shows one season's most important jump figures, compared with the season before, and can be printed. The money figures sit in a separate section that only the server PC can open.

**Architecture:** Two pure functions in `src/server/stats.ts` turn one year's registrations into a `JumpStats` and a `MoneyStats` object. `src/server/routes/stats.ts` runs them for the chosen year and for the year before, and serves the result as `GET /api/stats` (everyone) and `GET /api/stats/money` (server PC only, via `isLocal`). The manifest gets a `Statistik.tsx` page with hand-built CSS/SVG charts and a print stylesheet. No chart library is added, because the exe ships with no extra dependencies.

**Tech Stack:** Fastify 5, better-sqlite3, React 19, Vite, Vitest + Testing Library, plain CSS with the tokens in `web/manifest/src/index.css`.

**Spec:** None separate. The decisions below are the spec, from the chat of 2026-11-01:
- only the most important metrics
- no payouts and no manually changed prices
- money kept apart because it is confidential
- no unpaid figures, because unpaid tandems should never happen
- focus on a yearly report

## Decisions (the spec)

- **A yearly report, not a live monitor:** the page heading is `Jahresbericht {year}`; the sidebar tab is `Statistik`. Every headline figure is shown next to the previous year's, so the page answers "how did this season go compared with the last one?". It prints cleanly on A4 landscape for the club meeting.
- **Period:** one calendar year (the season). The page opens on the current year. `‹` and `›` step between years that have data, the same way the Übersicht steps between months.
- **Fair comparison for a running season:** when the year shown is the current year, the previous year is counted only up to the same day and month (`asOf` = today's `MM-DD`). For a past year, the whole previous year counts. The page says which, for example `Vergleich: 2025 bis 1. November` or `Vergleich: 2025`.
- **Season facts:**
  - first and last jump day of the season
  - best month
  - busiest day
- **What counts as a tandem:** every registration with a `jump_date` in the year. The Übersicht calendar and the Tagesabschluss payouts already use this rule. Paid status is not shown anywhere: unpaid tandems should never occur, so the report doesn't present them as a figure.
- **Retired crew:** names come from `tandem_masters` and `camera_flyers` whatever their `active` flag says. Old seasons must still show people who have left.
- **Money is confidential:**
  - `/api/stats/money` answers 403 to any device that is not the server PC.
  - On the PC, the money section stays closed until someone clicks `Umsatz anzeigen`. It closes again when the page is left.
  - It prints only while it is open.
- **Metrics kept (jump):**
  - tandems, jump days, average per jump day, video share, share flown on a voucher, each with the previous year's value and the change in percent
  - season facts
  - tandems per month, this year against last year
  - tandems per weekday
  - booked service split
  - tandem master ranking, with each master's change in tandems against last year
  - camera flyer ranking
  - gender split, age groups, top home towns
- **Metrics kept (money):**
  - Leistungswert (Σ price + voucher value redeemed), with the previous year and the change
  - collected (Σ price) and voucher value redeemed
  - average per tandem
  - cash vs card
  - Leistungswert per month, this year against last year
- **Dropped on purpose:**
  - payouts and manually changed prices
  - unpaid count and open amounts
  - master + flyer pairs, registration hour, repeat guests
  - weight surcharges, voucher check statuses, loads

## Global Constraints

- Code, comments, identifiers, test names and commits in English. UI text in German (CLAUDE.md).
- The manifest targets 1920x1080 and larger. Do not design for 1366x768 (memory).
- Light and dark mode both through the existing `:root` tokens. Add new tokens to both blocks in `index.css`. Never hard-code a colour in a component.
- Sunlight readability: text at least 4.5:1, chart marks at least 3:1 against `--panel-bg` (see the comments on `--accent` and `--control-border`).
- No new runtime dependency in `package.json` or `web/manifest/package.json`.
- Amounts in the UI use the existing `formatEuro` from `web/manifest/src/pricing.ts`. Dates use `de-AT`.
- Year parameter: `^\d{4}$`. Anything else answers 400 `{ error: 'Jahr ungültig' }`.
- Change in percent: `Math.round((now - before) / before * 100)`, shown with a sign (`+12 %`, `−8 %`, `±0 %`). When `before` is 0 or there is no previous year, show no change at all, never `+∞ %` or `NaN %`.

## Review Focus

1. **A year with no registrations at all** (a fresh install, or January): the page must show a calm empty state, not `NaN`, `Infinity` or `-Infinity`. Tested in Task 1 (`emptyYear`), Task 2 (`money of an empty year`) and Task 4 (`shows an empty state`).
2. **The first season, with no previous year:** no change figures, no ghost bars, no "Vergleich" line, and no `0 %` placeholders. Tested in Task 3 (`previous is null`) and Task 4 (`first season shows no comparison`).
3. **A running season compared with a full one:** the previous year must be cut at the same day, or every November report would look like a collapse in spring. Tested in Task 3 (`cuts the previous year at the same day`).
4. **A tablet or phone on the club WLAN opening Statistik:** it must never receive money figures and must not show the `Umsatz anzeigen` button. Tested in Task 3 (403) and Task 5 (button absent).
5. **A day without a frozen price list (`day_tables` row missing):** the voucher value falls back to the current config prices via `tablesForDay`. Statistics must never create a `day_tables` row. Tested in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/server/stats.ts` (create) | Pure: `jumpStats()` and `moneyStats()`, plus their types. No DB access. |
| `src/server/routes/stats.ts` (create) | Reads the rows of the year and of the comparison period, the name maps, and attaches `previous`. Applies `isLocal` to money. |
| `src/server/index.ts` (modify) | Registers the stats routes next to `registerCalendarRoutes`. |
| `tests/stats.test.ts` (create) | Unit tests for the pure functions. |
| `tests/stats-route.test.ts` (create) | Route tests through `testServer()`. |
| `web/manifest/src/api.ts` (modify) | `JumpStats` / `MoneyStats` types (duplicated, as the file already does for `Prices`), plus `statistik()` and `statistikMoney()`. |
| `web/manifest/src/statsCharts.tsx` (create) | Presentational pieces: `KpiTile`, `ColumnChart`, `ShareBar`, `RankList`, `change()`. |
| `web/manifest/src/statsCharts.test.tsx` (create) | Tests for `change()`. |
| `web/manifest/src/Statistik.tsx` (create) | The page: year navigation, report layout, print button, money section. |
| `web/manifest/src/Statistik.test.tsx` (create) | Page tests with `./api` mocked, like `Overview.test.tsx`. |
| `web/manifest/src/App.tsx` (modify) | `'statistik'` in `View`, a sidebar tab between "Manifest" and "Tarife", render the page. |
| `web/manifest/src/index.css` (modify) | A `/* Statistik */` section with the report layout, chart styles and an `@media print` block. |
| `PRODUCT.md` (modify) | Lists Statistik among the manifest views (Task 5). |

---

### Task 1: `jumpStats()`, the jump figures of one period

**Files:**
- Create: `src/server/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Produces:

```ts
export interface StatsRow {
  jump_date: string
  tandem_master_id: number | null
  camera_flyer_id: number | null
  extra_booking: string | null
  payment_method: string | null
  gender: string | null
  age: number | null
  city: string | null
  // Used only by moneyStats (Task 2):
  price: number | null
  voucher_payment_method: string | null
  voucher_service: string | null
  voucher_check_status: string | null
  voucher_accepted: number | null
}

export interface DayCount { date: string; count: number }

export interface MasterStats {
  name: string | null      // null = registrations without a tandem master
  tandems: number
  days: number
  bestDay: DayCount        // earliest date wins a tie
  video: number            // extra_booking video or video_photo
  previous: number | null  // tandems in the comparison period; filled in by the route, jumpStats sets null
}

export interface FlyerStats {
  name: string | null      // null = video booked, no flyer entered
  jumps: number            // rows with video or video_photo
  days: number
  bestDay: DayCount
  videoPhoto: number       // of which video_photo
}

// The headline figures the report compares year against year.
export interface JumpTotals {
  tandems: number
  jumpDays: number
  video: number
  voucher: number          // payment_method 'voucher'
  months: number[]         // always 12, tandems per month Jan..Dec
}

export interface JumpStats extends JumpTotals {
  year: number
  years: number[]          // filled in by the route; jumpStats sets []
  firstDay: string | null  // first jump_date of the period
  lastDay: string | null
  busiestDay: DayCount | null
  monthDays: number[]      // always 12, jump days per month
  weekdays: { tandems: number; days: number }[]  // always 7, Mon..Sun
  services: { none: number; video: number; video_photo: number }
  masters: MasterStats[]   // tandems desc, then name (de collation); null name last
  flyers: FlyerStats[]     // jumps desc, then name; null name last
  gender: { female: number; male: number; diverse: number }
  ageGroups: number[]      // 6 buckets: <18, 18–25, 26–35, 36–50, 51–65, >65; null/0 age skipped
  cities: { city: string; count: number }[]      // top 8, count desc, then city
  previous: JumpTotals | null                    // filled in by the route; jumpStats sets null
  comparedTo: { year: number; asOf: string | null } | null  // filled in by the route; asOf is 'MM-DD' or null for the full year
}

export function jumpStats(
  rows: StatsRow[], masterNames: Map<number, string>, flyerNames: Map<number, string>, year: number,
): JumpStats
```

An id missing from the name map counts as `null`, the same as a null id. A `null` or unknown `extra_booking` counts as `none`.

- [ ] **Step 1: Write the failing tests** in `tests/stats.test.ts`, using a `row(overrides: Partial<StatsRow>): StatsRow` helper whose defaults are `jump_date: '2026-06-06'`, everything else null:
  - `emptyYear`: `jumpStats([], new Map(), new Map(), 2026)` → `tandems 0, jumpDays 0, firstDay null, lastDay null, busiestDay null, masters [], flyers [], cities [], previous null`, `months`/`monthDays` 12 zeros, `weekdays.length 7` all zero, `ageGroups` `[0,0,0,0,0,0]`.
  - `counts tandems, days and the season`: dates `2026-04-11 ×1`, `2026-06-06 ×3`, `2026-06-07 ×3`, `2026-10-24 ×1` → `tandems 8, jumpDays 4, firstDay '2026-04-11', lastDay '2026-10-24', busiestDay { date: '2026-06-06', count: 3 }` (the earliest date wins the tie).
  - `months and weekdays`: `2026-06-06` (Sat) ×2 and `2026-07-05` (Sun) ×1 → `months[5] 2, monthDays[5] 1, months[6] 1`, `weekdays[5]` `{ tandems: 2, days: 1 }`, `weekdays[6]` `{ tandems: 1, days: 1 }`.
  - `ranks tandem masters, unassigned last`: master 1 "Anna" ×3 (one with `extra_booking: 'video'`), master 2 "Bert" ×1, `tandem_master_id: null` ×5, `tandem_master_id: 99` (not in the map) ×1 → `masters.map(m => m.name)` equals `['Anna', 'Bert', null]`, Anna `{ tandems: 3, video: 1, days: 1, previous: null }`, null entry `tandems 6`.
  - `ranks camera flyers from video rows only`: flyer 1 "Cara" with `video` ×1 and `video_photo` ×2, plus one row with `extra_booking: 'none'` and `camera_flyer_id: 1` → Cara `{ jumps: 3, videoPhoto: 2 }`.
  - `services, gender and voucher`: a 4-row fixture with one each of `none`, `video`, `video_photo` and `null`, mixed genders, and one `payment_method: 'voucher'` → `services { none: 2, video: 1, video_photo: 1 }`, `voucher 1`, `video 2`, and the gender counts of the fixture.
  - `age groups`: ages `[17, 18, 25, 26, 50, 51, 66, null, 0]` → `[1, 2, 1, 1, 1, 1]`.
  - `merges town spellings`: cities `'Linz'`, `'Linz '`, `'linz'`, `'Freistadt'`, `'  '`, null → `cities` equals `[{ city: 'Linz', count: 3 }, { city: 'Freistadt', count: 1 }]`. Group on trimmed, lower-cased text and show the most frequent spelling.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run tests/stats.test.ts`
  Expected: FAIL, `Cannot find module '../src/server/stats'`.

- [ ] **Step 3: Implement `jumpStats()` and the types in `src/server/stats.ts`.** Write it in the style of `payouts.ts`: a top comment that explains why every registration counts as a tandem. Weekday from `new Date(\`${date}T00:00:00Z\`).getUTCDay()`, shifted so Monday is 0.

- [ ] **Step 4: Run the tests and check they pass**
  Run: `npx vitest run tests/stats.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git add src/server/stats.ts tests/stats.test.ts`
  `git commit -m "feat(server): compute a season's jump statistics"`

---

### Task 2: `moneyStats()`, the confidential figures

**Files:**
- Modify: `src/server/stats.ts`
- Test: `tests/stats.test.ts`

**Interfaces:**
- Consumes: `StatsRow` (Task 1); `voucherCovered`, `collectedVia`, `PricedFields` from `src/server/pricing.ts`; `Prices` from `src/server/config.ts`.
- Produces:

```ts
export interface MoneyTotals {
  value: number         // Leistungswert = collected + voucherValue
  collected: number     // Σ price over all rows
  voucherValue: number  // Σ voucherCovered(row, pricesFor(row.jump_date))
  months: number[]      // always 12: value per month
}

export interface MoneyStats extends MoneyTotals {
  year: number
  perTandem: number     // value / rows.length, 0 when no rows
  tills: { cash: number; card: number; unrecorded: number }  // collected, split by collectedVia(row); null → unrecorded
  previous: MoneyTotals | null                            // filled in by the route; moneyStats sets null
  comparedTo: { year: number; asOf: string | null } | null  // same as JumpStats.comparedTo
}

export function moneyStats(rows: StatsRow[], pricesFor: (date: string) => Prices, year: number): MoneyStats
```

- [ ] **Step 1: Write the failing tests**, with prices `{ jump: 270, video: 100, video_photo: 120, weight_over_90: 40, weight_over_100: 60 }` via `pricesFor = () => prices`:
  - `money of an empty year`: all amounts 0, `perTandem 0`, `months` 12 zeros, `previous null`.
  - `adds collected and voucher value`: cash rows of 370 and 270, a card row of 270, and a voucher row (`voucher_service: 'jump_video'`, `extra_booking: 'video'`, price 0) → `collected 910, voucherValue 370, value 1280, perTandem 320`, `tills { cash: 640, card: 270, unrecorded: 0 }`.
  - `a rejected voucher is worth nothing`: a voucher row with `voucher_check_status: 'cancelled'`, `voucher_accepted: 0` → `voucherValue 0`. Same row with `voucher_accepted: 1` → 370.
  - `a voucher top-up lands in its till`: `payment_method: 'voucher'`, `voucher_payment_method: 'card'`, price 40 → `tills.card 40`.
  - `uses each day's own prices`: a `pricesFor` that returns `jump: 250` for `2025-…` dates and `jump: 270` otherwise, and two `jump` voucher rows on different dates → `voucherValue 520`.
  - `value per month`: rows in June and July → `months[5]` and `months[6]` hold their values, every other month is 0.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run tests/stats.test.ts`
  Expected: the new tests FAIL, `moneyStats is not a function`.

- [ ] **Step 3: Implement `moneyStats()`.** Cast the row with `row as PricedFields` for `voucherCovered`, the same way `payouts.ts` reads rows. Do not round in the function; the UI formats.

- [ ] **Step 4: Run the tests and check they pass**
  Run: `npx vitest run tests/stats.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  `git commit -am "feat(server): compute a season's money statistics"`

---

### Task 3: The `/api/stats` routes, with the year-on-year comparison

**Files:**
- Create: `src/server/routes/stats.ts`
- Modify: `src/server/index.ts` (import, plus `registerStatsRoutes(app, db, cfgRef)` after `registerCalendarRoutes`)
- Test: `tests/stats-route.test.ts`

**Interfaces:**
- Consumes: `jumpStats`, `moneyStats`, `StatsRow`, `JumpTotals`, `MoneyTotals` (Tasks 1–2); `tablesForDay` from `src/server/dayTables.ts`; `isLocal` from `src/server/routes/isLocal.ts`.
- Produces:
  - `export function registerStatsRoutes(app: FastifyInstance, db: Database, cfgRef: { current: Config }, now: () => Date = () => new Date()): void`. `now` is injectable so the "current year" rule can be tested.
  - `GET /api/stats?year=YYYY` → `JumpStats`. Without `year`, the current local year.
    - `years` holds the distinct `substr(jump_date,1,4)` values as numbers, ascending. The requested year is always included, even when it has no data, so the page can stand on it.
    - The comparison period is `year − 1` from `01-01` to `12-31`. When `year` is the current year, it ends at `asOf` = today's `MM-DD` instead.
    - If the comparison period has no rows: `previous` and `comparedTo` are `null`, and every `masters[i].previous` stays `null`.
    - Otherwise: `previous` holds the period's `JumpTotals`, and `comparedTo` is `{ year: year − 1, asOf }`, with `asOf` null for the full year. Each `masters[i].previous` is that master's tandems in the period, or 0 if they had none.
  - `GET /api/stats/money?year=YYYY` → `MoneyStats`, with `previous`/`comparedTo` filled by the same rule. Or 403 `{ error: 'Nur am Manifest-PC verfügbar' }` when `!isLocal(req.ip)`.

- [ ] **Step 1: Write the failing tests** in `tests/stats-route.test.ts`. Build the app with `buildServer` through `testServer()` (extend the helper with an optional `now` passed through `buildServer` to `registerStatsRoutes`). Use a `REMOTE = '192.168.0.42'` constant like `tests/shutdown.test.ts`.
  - `answers the requested year only`: seed `2025-08-01`, `2026-06-06 ×2`, with now 2027-03-01 → `GET /api/stats?year=2026` → `tandems 2`, `years [2025, 2026]`.
  - `compares a past year with the whole year before`: seed `2025-05-01`, `2025-09-01`, `2026-06-06`, with now 2027-03-01 → `?year=2026` → `previous.tandems 2`, `comparedTo { year: 2025, asOf: null }`.
  - `cuts the previous year at the same day`: same seed, now `2026-07-01` → `?year=2026` → `previous.tandems 1`, `comparedTo { year: 2025, asOf: '07-01' }`.
  - `previous is null`: seed only 2026 rows → `previous null`, `comparedTo null`, `masters[0].previous null`.
  - `a master's own change`: master "Anna" with 2 tandems in 2025 and 3 in 2026, now 2027-03-01 → Anna's `previous 2`. A master new in 2026 → `previous 0`.
  - `a year without data still answers`: `?year=2030` → 200, `tandems 0`, `years` contains `2030`.
  - `rejects a malformed year`: `'26'`, `'2026-06'`, `'abc'` → 400.
  - `names retired crew`: insert a master with `active = 0` and one row for them → `masters[0].name` is that name.
  - `money for the server PC`: seed a cash row with price 370 in 2026 and one with 270 in 2025, now 2027-03-01 → `GET /api/stats/money?year=2026` → 200, `collected 370`, `previous.collected 270`.
  - `no money for the network`: same request with `remoteAddress: REMOTE` → 403, and the body has no `collected` key.
  - `reading statistics freezes no day`: seed a voucher row on a day without `day_tables`, call the money route, then `SELECT COUNT(*) FROM day_tables` is still 0.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run tests/stats-route.test.ts`
  Expected: FAIL with 404s.

- [ ] **Step 3: Implement the routes.**
  - Use one prepared `SELECT <StatsRow columns> FROM registrations WHERE jump_date BETWEEN ? AND ?`, run for the year (`${year}-01-01`..`${year}-12-31`) and for the comparison period (`${year-1}-01-01`..`${year-1}-${asOf ?? '12-31'}`).
  - Name maps come from `SELECT id, name FROM tandem_masters` / `camera_flyers` (no `active` filter).
  - `pricesFor` is `(date) => tablesForDay(db, date, cfgRef.current).prices`, memoised per date in a `Map` for the request.
  - The "current year" and today's `MM-DD` come from `now()` in local time.
  - The doc comment says why money is gated with `isLocal` and points to `isLocal.ts`, and explains the same-day cut.

- [ ] **Step 4: Run the tests and check they pass, then run the whole server suite**
  Run: `npx vitest run tests/stats-route.test.ts` then `npm test`
  Expected: PASS, with no other test changed.

- [ ] **Step 5: Commit**
  `git add src/server/routes/stats.ts src/server/index.ts tests/stats-route.test.ts tests/helpers/testServer.ts`
  `git commit -m "feat(server): serve the yearly report, money only to the manifest PC"`

---

### Task 4: The Statistik page, the yearly report

**Files:**
- Modify: `web/manifest/src/api.ts` (types + two functions, next to `calendar()`)
- Create: `web/manifest/src/statsCharts.tsx`, `web/manifest/src/statsCharts.test.tsx`, `web/manifest/src/Statistik.tsx`, `web/manifest/src/Statistik.test.tsx`
- Modify: `web/manifest/src/App.tsx`, `web/manifest/src/App.test.tsx`, `web/manifest/src/index.css`

**Interfaces:**
- Consumes: the JSON shapes from Task 3, copied into `api.ts` as `JumpStats`, `JumpTotals`, `MasterStats`, `FlyerStats`, `DayCount`, `MoneyStats`, `MoneyTotals` with the same field names.
- Produces:
  - `export async function statistik(year: number): Promise<JumpStats>`: throws `Error('Statistik konnte nicht geladen werden')` on non-2xx, like `calendar()`.
  - `export async function statistikMoney(year: number): Promise<MoneyStats | null>`: `null` on 403, throws on any other non-2xx.
  - `export default function Statistik(): JSX.Element`
  - In `statsCharts.tsx`:
    - `change(now: number, before: number | null | undefined): string | null`: `'+12 %'`, `'−8 %'` (U+2212), `'±0 %'`. Returns `null` when `before` is null, undefined or 0.
    - `KpiTile({ label, value, previous?, delta? }: { label: string; value: string; previous?: string; delta?: string | null })`: big value; under it a quiet line `{previous} im Vorjahr` and the delta. The delta is coloured `--accent` when it starts with `+` and `--warn-text` when it starts with `−`. Its words carry the meaning too, so colour is never the only signal.
    - `ColumnChart({ labels, values, previous?, format?, ariaLabel }: { labels: string[]; values: number[]; previous?: number[] | null; format?: (n: number) => string; ariaLabel: string })`: vertical bars with the value above each non-zero bar. When `previous` is given, a thin outlined ghost bar for the previous year stands behind each bar. A `role="img"` wrapper carries `aria-label`.
    - `ShareBar({ parts, ariaLabel }: { parts: { label: string; value: number }[]; ariaLabel: string })`: one stacked horizontal bar plus a legend with count and percent.
    - `RankList({ rows }: { rows: { name: string; value: number; detail: string; delta?: string | null }[] })`: a list with an inline bar scaled to the top value.

**Layout at 1920x1080** (the page uses `view-wide`):

```
┌ Jahresbericht 2026 ───────────────── ‹ 2026 ›  [Drucken] ┐
│ Vergleich: 2025 bis 1. November                            │
│ Saison 11. Apr – 24. Okt · bester Monat Juni (42) · stärkster Tag Sa., 6. Juni (14) │
│ [Tandems] [Sprungtage] [Ø pro Sprungtag] [Mit Video] [Mit Gutschein] │  each: value, "… im Vorjahr", ±%
├─────────────────────────────────────┬──────────────────────┤
│ Tandems pro Monat (ColumnChart,     │ Gebuchte Leistung    │
│ ghost bars = Vorjahr)               │ (ShareBar)           │
├─────────────────────────────────────┼──────────────────────┤
│ Tandemmaster (RankList, detail      │ Kameraflieger        │
│ "6 Tage · bester Tag 8 · 40 % Video",│ (RankList)          │
│ delta vs Vorjahr)                   │                      │
├──────────────────┬──────────────────┴──────────────────────┤
│ Wochentage       │ Gäste: Alter (ColumnChart), Geschlecht    │
│ (ColumnChart)    │ (ShareBar), Top-Orte (RankList)           │
├──────────────────┴─────────────────────────────────────────┤
│ Umsatz (Task 5)                                             │
└─────────────────────────────────────────────────────────────┘
```

- **Months shown:** from the first to the last month with tandems in either year, widened to at least April–October. A normal season reads at a glance, and a winter jump is not hidden.
- **Unassigned crew:** `null` names show as `ohne Tandemmaster` / `ohne Kameraflieger`.
- **Printing:** `Drucken` calls `window.print()`. An `@media print` block:
  - hides the sidebar, the year nav, the print button and the money toggle
  - prints the report on A4 landscape (`@page { size: A4 landscape; margin: 12mm }`) in light colours whatever the screen theme
  - keeps each panel on one page (`break-inside: avoid`)
- **Copy (German, exact):**

| Element | Text |
|---|---|
| Page heading | `Jahresbericht {year}` |
| Year navigation (`aria-label`) | `Vorheriges Jahr` / `Nächstes Jahr` |
| Print button | `Drucken` |
| Comparison line | `Vergleich: {year−1}`, plus ` bis {d. MMMM}` when `asOf` is set |
| Season line | `Saison {first} – {last} · bester Monat {Monat} ({n}) · stärkster Tag {date} ({n})` |
| KPI labels | `Tandems`, `Sprungtage`, `Ø pro Sprungtag`, `Mit Video`, `Mit Gutschein` |
| Section headings | `Tandems pro Monat`, `Gebuchte Leistung`, `Tandemmaster`, `Kameraflieger`, `Wochentage`, `Gäste` |
| Service labels | `nur Sprung`, `Sprung+Video`, `Sprung+Video+Foto` |
| Empty state | `Keine Tandems in {year}.` |

- [ ] **Step 1: Write the failing tests** in `Statistik.test.tsx`. Mock `./api` like `Overview.test.tsx`, set the date to 2026-11-01, and use a `stats(overrides)` fixture builder:
  - `opens on the current year`: `statistik` is called with `2026`, and the heading `Jahresbericht 2026` shows.
  - `shows the key figures against last year`: fixture `tandems 125, jumpDays 20, video 50`, `previous { tandems 100, jumpDays 20, video 50, voucher 0 }`, `comparedTo { year: 2025, asOf: '11-01' }` → the tiles read `125`, `20`, `6,3` and `40 %`. The Tandems tile shows `100 im Vorjahr` and `+25 %`; the Sprungtage tile shows `±0 %`. The text `Vergleich: 2025 bis 1. November` is present.
  - `first season shows no comparison`: `previous null` → no text matching `/im Vorjahr|Vergleich/`, and no ghost bars (`.chart-ghost` count 0).
  - `shows the season facts`: `firstDay '2026-04-11', lastDay '2026-10-24'`, June the highest month with 42, `busiestDay { date: '2026-06-06', count: 14 }` → the season line contains `11. Apr`, `24. Okt`, `Juni (42)` and `(14)`.
  - `steps between years with data`: `years [2025, 2026]` → `Nächstes Jahr` is disabled; clicking `Vorheriges Jahr` calls `statistik(2025)`.
  - `ranks tandem masters, unassigned last, with their change`: masters `Anna 30 (previous 20)`, `null 2` → list items in order `Anna`, `ohne Tandemmaster`; Anna's row shows `+50 %`.
  - `prints the report`: `window.print` mocked; clicking `Drucken` calls it once.
  - `shows an empty state`: `tandems 0` → text `Keine Tandems in 2026.`, no `role="img"` chart, and no `Drucken` button.
  - `says when loading failed`: `statistik` rejects → a `role="alert"` with `Statistik konnte nicht geladen werden`.
  - In `statsCharts.test.tsx`, for `change()`: `(125, 100)` → `'+25 %'`, `(92, 100)` → `'−8 %'`, `(5, 5)` → `'±0 %'`, `(5, 0)` → `null`, `(5, null)` → `null`.
  - In `App.test.tsx`, `the sidebar opens Statistik`: clicking the `Statistik` tab renders the `Jahresbericht` heading.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npm --prefix web/manifest test -- Statistik statsCharts App`
  Expected: FAIL, the modules are not found and the tab is missing.

- [ ] **Step 3: Implement** the `api.ts` additions, `statsCharts.tsx`, `Statistik.tsx`, the `App.tsx` tab (`View` gets `'statistik'`; place the tab between `Manifest` and `Tarife`) and the `index.css` section, including `@media print`. Before writing the CSS and charts, load the `impeccable:impeccable` and `dataviz` skills. Read the existing `.calendar-*` and `.panel` styles so the report looks like part of the manifest. Design rules:
  - It should read as a report: a calm heading block, then figures, then detail.
  - One accent colour (`--accent`) for this year's bars. The previous year is a quiet outline in `--rule`, never a second loud colour.
  - The ShareBar uses three tones derived from `--accent`, `--sky` and `--ember`, with new tokens `--chart-1..3` in both colour-scheme blocks.
  - Numbers in `font-variant-numeric: tabular-nums`.
  - No gradients, no drop shadows on bars, no chart gridlines. Values are written on the bars instead.
  - KPI values are large, labels and the previous-year line small and quiet.
  - Panels use the existing panel background and border.

- [ ] **Step 4: Run the tests and check they pass, then type-check and build**
  Run: `npm --prefix web/manifest test` then `npm --prefix web/manifest run build`
  Expected: all PASS, and the build succeeds with no type errors.

- [ ] **Step 5: Look at it and print it.** Load the `run` skill and start the app against a database with data in two seasons. Copy `dist/tandem.db` to the scratchpad and duplicate its rows into 2025 with a SQL `INSERT … SELECT` that shifts `jump_date` back one year. Then check:
  - screenshots of Statistik at 1920x1080 in light and dark mode
  - the print preview (Chrome "Save as PDF", A4 landscape): every panel is whole, no sidebar, light colours
  
  Fix anything that breaks the design rules, clips or overlaps.

- [ ] **Step 6: Commit**
  `git add web/manifest/src`
  `git commit -m "feat(manifest): Statistik shows the yearly report against last year"`

---

### Task 5: The money section

**Files:**
- Modify: `web/manifest/src/Statistik.tsx`, `web/manifest/src/Statistik.test.tsx`, `web/manifest/src/index.css`
- Modify: `PRODUCT.md`, the "Manifest views" line under Capabilities and Constraints

**Interfaces:**
- Consumes: `statistikMoney(year)`, `KpiTile`, `ShareBar`, `ColumnChart`, `change()` (Task 4), and `formatEuro` from `./pricing`.

Behaviour:
- When the page loads a year, it calls `statistikMoney(year)`. On `null`, nothing about money renders at all: no button and no hint.
- Otherwise a closed section at the bottom shows a button `Umsatz anzeigen` (`aria-expanded="false"`).
- When opened, the section shows:
  - KPI tiles: `Leistungswert`, with its previous year and change; `Kassiert`; `Gutscheinwert`; `Ø pro Tandem`
  - a ShareBar `Bar` / `Karte` / `nicht erfasst`, leaving out zero parts
  - a ColumnChart `Leistungswert pro Monat`, with the previous year as ghost bars, over the same months as the tandem chart
  
  The button then reads `Umsatz ausblenden`.
- A small line under the heading: `Nur an diesem PC sichtbar.`
- The open state survives a year change and resets when the page unmounts. It is not stored anywhere.
- Printing: the section prints only while it is open. The money toggle button itself never prints.

- [ ] **Step 1: Write the failing tests:**
  - `hides money from other devices`: `statistikMoney` resolves `null` → `queryByRole('button', { name: 'Umsatz anzeigen' })` is null.
  - `money stays closed until asked`: a resolved `MoneyStats` with `value: 8570` and `previous.value 7000` → no text `Leistungswert` until the button is clicked. After the click, `8.570 €`, `7.000 € im Vorjahr`, `+22 %` and the button `Umsatz ausblenden` are visible.
  - `keeps money open across years`: open it, click `Vorheriges Jahr` → `statistikMoney` is called with `2025` and the section is still open.
  - `closed money is left out of the print`: while closed, the money section element is absent from the DOM, not just hidden with CSS.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npm --prefix web/manifest test -- Statistik`
  Expected: the 4 new tests FAIL.

- [ ] **Step 3: Implement** the section with the Task 4 components, with `format={formatEuro}`.

- [ ] **Step 4: Run all tests, build, and screenshot the opened section** in light and dark mode, plus the print preview with the section open, as in Task 4 Step 5.
  Run: `npm test`, `npm --prefix web/manifest test`, `npm --prefix web/manifest run build`
  Expected: all PASS.

- [ ] **Step 5: Add Statistik to `PRODUCT.md`.** In the "Manifest views" line, add `Statistik (yearly report against the previous year, printable; money only on the manifest PC)`.

- [ ] **Step 6: Commit**
  `git commit -am "feat(manifest): yearly report shows the season's money on the manifest PC only"`
