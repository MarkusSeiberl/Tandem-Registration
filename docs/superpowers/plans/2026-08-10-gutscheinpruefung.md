# Gutscheinprüfung Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The manifest checks a typed voucher number against the club's Tandemliste.xlsx, says whether it was paid and not yet redeemed, warns when the voucher's Art disagrees with the booked service, and writes the redemption date back into the `Eingelöst` column.

**Architecture:** A read-only parser (`voucherList.ts`) turns the club's sheet into a lookup map, cached against the file's mtime so a OneDrive file is not re-read per keystroke. A separate writer (`voucherRedeem.ts`) sets the one cell it is allowed to touch, after backing the file up once a day. Our own database is the record of a redemption; the Excel file is a copy we keep in step, retried at export when the file was locked.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, ExcelJS (already a dependency), React + Vite for the manifest, Vitest.

Spec: `docs/superpowers/specs/2026-08-10-gutscheinpruefung-design.md`

## Global Constraints

- All user-visible text is German. Code, comments and commit messages are English, matching the existing codebase.
- **Nothing in this feature may block saving or collecting a row.** Every failure is a message, never a disabled button.
- `voucherListPath` empty ⇒ the feature is invisible: no status line, no warning, no error.
- The `Eingelöst` cell is written **only** when the voucher is valid **and** the cell is empty. Never overwrite.
- Column positions are never hardcoded — columns are found by their header text in row 1.
- Server tests: `npx vitest run <file>`. Manifest tests: `npm --prefix web/manifest test`.
- Amounts render through the existing `formatEuro`; dates shown to the user are `TT.MM.JJJJ`.
- Work happens on branch `feature/gutscheinpruefung`, which already carries the spec.

## File Structure

| File | Responsibility |
| ---- | -------------- |
| `src/server/voucherList.ts` (new) | Normalising numbers, mapping `Art` to a service, reading + caching the sheet, deriving a status |
| `src/server/voucherRedeem.ts` (new) | Daily backup and the single-cell write into `Eingelöst` |
| `src/server/routes/voucher.ts` (new) | `GET /api/voucher`, `GET /api/voucher/pending` |
| `src/server/config.ts` | `voucherListPath` setting |
| `src/server/db.ts` | `voucher_redeemed_at`, `voucher_redeem_synced_at` columns |
| `src/server/routes/registrations.ts` | Redeem attempt when a voucher row is collected |
| `src/server/routes/export.ts` | Sweep of redeemed-but-unwritten rows |
| `src/server/index.ts` | Register the voucher routes |
| `tests/helpers/voucherFile.ts` (new) | Builds a temporary Tandemliste.xlsx for tests |
| `web/manifest/src/voucher.ts` (new) | Client types + fetch for the check |
| `web/manifest/src/Detail.tsx` | Status line under the Gutschein-Nr. field |
| `web/manifest/src/List.tsx` | Pending-redemptions banner |
| `web/manifest/src/Settings.tsx` | Path field |

---

### Task 1: Number normalising and Art mapping

Pure functions, no file access. Everything later depends on these names.

**Files:**
- Create: `src/server/voucherList.ts`
- Test: `tests/voucherList.test.ts`

**Interfaces:**
- Consumes: `WeightSurcharge`-style enums from `src/server/pricing.ts` — specifically `VoucherService = 'jump' | 'jump_video' | 'jump_video_photo'`.
- Produces:
  - `normaliseVoucherNumber(raw: string): string`
  - `serviceFromArt(art: string | null): { service: VoucherService | null; isAddOn: boolean }`

- [ ] **Step 1: Write the failing test**

Create `tests/voucherList.test.ts`:

```ts
import { test, expect } from 'vitest'
import { normaliseVoucherNumber, serviceFromArt } from '../src/server/voucherList'

test('the same voucher written three ways normalises to one key', () => {
  const canonical = normaliseVoucherNumber('26-001')
  expect(normaliseVoucherNumber('26-1')).toBe(canonical)
  expect(normaliseVoucherNumber('26 001')).toBe(canonical)
  expect(normaliseVoucherNumber('  26-001  ')).toBe(canonical)
  expect(normaliseVoucherNumber('26/001')).toBe(canonical)
})

test('different vouchers stay different', () => {
  // Joining the groups keeps the separator meaningful: 26001 is not 26-001.
  expect(normaliseVoucherNumber('26001')).not.toBe(normaliseVoucherNumber('26-001'))
  expect(normaliseVoucherNumber('26-002')).not.toBe(normaliseVoucherNumber('26-001'))
  expect(normaliseVoucherNumber('25-001')).not.toBe(normaliseVoucherNumber('26-001'))
})

test('a group that is only zeros survives normalising', () => {
  expect(normaliseVoucherNumber('26-0')).toBe('26-0')
})

test('letters are kept and folded to upper case', () => {
  expect(normaliseVoucherNumber('gs26-001')).toBe(normaliseVoucherNumber('GS26-001'))
})

test('Art maps to the service it covers', () => {
  expect(serviceFromArt('Tandem')).toEqual({ service: 'jump', isAddOn: false })
  expect(serviceFromArt('Tandem + Video')).toEqual({ service: 'jump_video', isAddOn: false })
  expect(serviceFromArt('Tandem + Video + Foto'))
    .toEqual({ service: 'jump_video_photo', isAddOn: false })
})

test('an Art without Tandem is an add-on, not a jump voucher', () => {
  // "Video + Foto zu GS25-2" tops up another voucher; reading it as a
  // Sprung+Video+Foto voucher would credit a jump nobody paid for.
  expect(serviceFromArt('Video + Foto zu GS25-2')).toEqual({ service: null, isAddOn: true })
})

test('an Art nobody recognises compares against nothing', () => {
  expect(serviceFromArt('Sonderaktion')).toEqual({ service: null, isAddOn: false })
  expect(serviceFromArt(null)).toEqual({ service: null, isAddOn: false })
  expect(serviceFromArt('')).toEqual({ service: null, isAddOn: false })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/voucherList.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/voucherList"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/server/voucherList.ts`:

```ts
import type { VoucherService } from './pricing'

// The club writes a voucher number as "26-001": a year prefix, a separator and
// a zero-padded counter. What the manifest types is whatever the guest's paper
// says, so both sides are reduced to the same shape before they are compared.
//
// The groups are re-joined with a single '-' rather than concatenated, so a
// separator stays meaningful: "26001" is a different voucher from "26-001".
export function normaliseVoucherNumber(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .split(/[^0-9A-Z]+/)
    .filter((part) => part.length > 0)
    // Leading zeros are padding, not value — but a group of only zeros keeps one.
    .map((part) => part.replace(/^0+(?=[0-9A-Z])/, ''))
    .join('-')
}

// `Art` is free text the club types, so it is read by keyword rather than
// matched against a list of exact spellings.
//
// Without "Tandem" the entry covers no jump: the sample list holds
// "Video + Foto zu GS25-2", an add-on bought on top of another voucher. Mapping
// that to jump_video_photo would hand the guest a jump that was never paid for,
// so it is reported as an add-on and compared against nothing.
export function serviceFromArt(
  art: string | null
): { service: VoucherService | null; isAddOn: boolean } {
  const text = (art ?? '').toLowerCase()
  const hasVideo = text.includes('video')
  const hasPhoto = text.includes('foto') || text.includes('photo')
  if (!text.includes('tandem')) return { service: null, isAddOn: hasVideo || hasPhoto }
  if (hasVideo && hasPhoto) return { service: 'jump_video_photo', isAddOn: false }
  if (hasVideo) return { service: 'jump_video', isAddOn: false }
  return { service: 'jump', isAddOn: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/voucherList.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/voucherList.ts tests/voucherList.test.ts
git commit -m "Add voucher number normalising and Art mapping"
```

---

### Task 2: Reading the sheet, with a test fixture builder

**Files:**
- Modify: `src/server/voucherList.ts`
- Create: `tests/helpers/voucherFile.ts`
- Test: `tests/voucherList.test.ts`

**Interfaces:**
- Consumes: `normaliseVoucherNumber` from Task 1.
- Produces:
  - `interface VoucherEntry { number: string; rowNumber: number; paidAt: Date | null; paidText: string | null; amount: number | null; art: string | null; service: VoucherService | null; isAddOn: boolean; redeemedAt: Date | null }`
  - `interface VoucherList { sheetName: string; byNumber: Map<string, VoucherEntry[]> }`
  - `readVoucherList(filePath: string): Promise<VoucherList>` — rejects with a German `Error` when the file or a required header is missing.
  - `tests/helpers/voucherFile.ts`: `writeVoucherFile(rows: VoucherFileRow[], options?: { headers?: string[] }): Promise<string>` and `type VoucherFileRow = { lfdNr?: string; einzahlDat?: Date | string | null; art?: string; betrag?: number; eingeloest?: Date | null }`

- [ ] **Step 1: Write the fixture builder**

Create `tests/helpers/voucherFile.ts`:

```ts
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'

export type VoucherFileRow = {
  lfdNr?: string
  einzahlDat?: Date | string | null
  art?: string
  betrag?: number
  eingeloest?: Date | null
}

// Mirrors the club's real sheet: header row 1, one sheet named "Tabelle1", and
// a stray trailing column — the reader must find its columns by name, not by
// counting from the left.
const DEFAULT_HEADERS = [
  'LfdNr', 'AusstellDat', 'EinzahlDat', 'Art', 'Betrag',
  'Nachname', 'Vorname', 'Eingelöst', 'E-Mail', 'Spalte1',
]

export async function writeVoucherFile(
  rows: VoucherFileRow[],
  options: { headers?: string[] } = {}
): Promise<string> {
  const headers = options.headers ?? DEFAULT_HEADERS
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Tabelle1')
  ws.addRow(headers)
  for (const row of rows) {
    const cells = headers.map((header) => {
      if (header === 'LfdNr') return row.lfdNr ?? ''
      if (header === 'EinzahlDat') return row.einzahlDat ?? null
      if (header === 'Art') return row.art ?? ''
      if (header === 'Betrag') return row.betrag ?? null
      if (header === 'Eingelöst') return row.eingeloest ?? null
      return ''
    })
    ws.addRow(cells)
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-vouchers-'))
  const filePath = path.join(dir, 'Tandemliste.xlsx')
  await wb.xlsx.writeFile(filePath)
  return filePath
}
```

- [ ] **Step 2: Write the failing test**

Append to `tests/voucherList.test.ts`:

```ts
import { readVoucherList } from '../src/server/voucherList'
import { writeVoucherFile } from './helpers/voucherFile'

test('reads the columns it needs by header name', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem + Video', betrag: 355 },
  ])
  const list = await readVoucherList(file)

  const entry = list.byNumber.get(normaliseVoucherNumber('26-001'))![0]
  expect(entry.number).toBe('26-001')
  expect(entry.amount).toBe(355)
  expect(entry.art).toBe('Tandem + Video')
  expect(entry.service).toBe('jump_video')
  expect(entry.paidAt?.toISOString().slice(0, 10)).toBe('2026-01-14')
  expect(entry.paidText).toBeNull()
  expect(entry.redeemedAt).toBeNull()
  // Row 1 is the header, so the first voucher is row 2 — the writer needs this.
  expect(entry.rowNumber).toBe(2)
})

test('an unpaid row and a STORNO row are told apart', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem', betrag: 255 },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem', betrag: 255 },
  ])
  const list = await readVoucherList(file)

  const unpaid = list.byNumber.get(normaliseVoucherNumber('26-007'))![0]
  expect(unpaid.paidAt).toBeNull()
  expect(unpaid.paidText).toBeNull()

  const cancelled = list.byNumber.get(normaliseVoucherNumber('26-009'))![0]
  expect(cancelled.paidAt).toBeNull()
  // Kept verbatim: the club may write something other than STORNO tomorrow.
  expect(cancelled.paidText).toBe('STORNO')
})

test('two rows sharing a number are both kept, so the caller can call it ambiguous', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-1', einzahlDat: new Date('2026-02-14'), art: 'Tandem' },
  ])
  const list = await readVoucherList(file)
  expect(list.byNumber.get(normaliseVoucherNumber('26-001'))).toHaveLength(2)
})

test('rows without a number are skipped rather than keyed on empty string', async () => {
  const file = await writeVoucherFile([
    { lfdNr: '', einzahlDat: new Date('2026-01-14') },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-14') },
  ])
  const list = await readVoucherList(file)
  expect(list.byNumber.size).toBe(1)
})

test('a missing required header is an error naming the column', async () => {
  const file = await writeVoucherFile([{ lfdNr: '26-001' }], {
    headers: ['LfdNr', 'EinzahlDat', 'Betrag'],
  })
  await expect(readVoucherList(file)).rejects.toThrow(/Eingelöst/)
})

test('a missing file is an error, not a crash', async () => {
  await expect(readVoucherList('C:/nope/keine-datei.xlsx')).rejects.toThrow()
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/voucherList.test.ts`
Expected: FAIL — `readVoucherList is not a function`.

- [ ] **Step 4: Write the implementation**

Append to `src/server/voucherList.ts`:

```ts
import ExcelJS from 'exceljs'

export interface VoucherEntry {
  /** As written in the sheet, for display. */
  number: string
  /** 1-based sheet row, so the redemption can be written back to it. */
  rowNumber: number
  paidAt: Date | null
  /** Set when EinzahlDat holds text instead of a date, e.g. "STORNO". */
  paidText: string | null
  amount: number | null
  art: string | null
  service: VoucherService | null
  isAddOn: boolean
  redeemedAt: Date | null
}

export interface VoucherList {
  sheetName: string
  /** Normalised number -> every row carrying it. More than one means ambiguous. */
  byNumber: Map<string, VoucherEntry[]>
}

const REQUIRED_HEADERS = ['lfdnr', 'einzahldat', 'eingelöst'] as const

// The club's sheet already carries a stray "Spalte1"; anyone inserting a column
// must not silently shift the reader onto the wrong data, so columns are located
// by their header text rather than by position.
function headerColumns(sheet: ExcelJS.Worksheet): Map<string, number> {
  const columns = new Map<string, number>()
  const header = sheet.getRow(1)
  for (let c = 1; c <= sheet.columnCount; c++) {
    const raw = header.getCell(c).value
    if (raw === null || raw === undefined) continue
    const key = String(typeof raw === 'object' && 'text' in raw ? (raw as any).text : raw)
      .trim()
      .toLowerCase()
      // The club's file spells it "Eingelöst"; tolerate an ASCII rewrite too.
      .replace('eingeloest', 'eingelöst')
    if (key.length > 0 && !columns.has(key)) columns.set(key, c)
  }
  return columns
}

function cellDate(value: ExcelJS.CellValue): { date: Date | null; text: string | null } {
  if (value instanceof Date) return { date: value, text: null }
  if (value === null || value === undefined) return { date: null, text: null }
  const text = String(value).trim()
  return { date: null, text: text.length > 0 ? text : null }
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

export async function readVoucherList(filePath: string): Promise<VoucherList> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(filePath)
  const sheet = wb.worksheets[0]
  if (!sheet) throw new Error('Die Gutscheinliste enthält kein Tabellenblatt.')

  const columns = headerColumns(sheet)
  const missing = REQUIRED_HEADERS.filter((h) => !columns.has(h))
  if (missing.length > 0) {
    const names = missing.map((m) => (m === 'eingelöst' ? 'Eingelöst' : m === 'lfdnr' ? 'LfdNr' : 'EinzahlDat'))
    throw new Error(`In der Gutscheinliste fehlt die Spalte ${names.join(', ')}.`)
  }

  const at = (row: ExcelJS.Row, key: string) => {
    const index = columns.get(key)
    return index === undefined ? null : row.getCell(index).value
  }

  const byNumber = new Map<string, VoucherEntry[]>()
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const number = cellText(at(row, 'lfdnr'))
    // A blank number is a spacer or a half-typed row, not a voucher.
    if (!number) continue

    const paid = cellDate(at(row, 'einzahldat'))
    const art = cellText(at(row, 'art'))
    const { service, isAddOn } = serviceFromArt(art)
    const entry: VoucherEntry = {
      number,
      rowNumber: r,
      paidAt: paid.date,
      paidText: paid.text,
      amount: cellNumber(at(row, 'betrag')),
      art,
      service,
      isAddOn,
      redeemedAt: cellDate(at(row, 'eingelöst')).date,
    }
    const key = normaliseVoucherNumber(number)
    const existing = byNumber.get(key)
    if (existing) existing.push(entry)
    else byNumber.set(key, [entry])
  }

  return { sheetName: sheet.name, byNumber }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/voucherList.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add src/server/voucherList.ts tests/helpers/voucherFile.ts tests/voucherList.test.ts
git commit -m "Read the club's voucher list by header name"
```

---

### Task 3: Caching and status lookup

**Files:**
- Modify: `src/server/voucherList.ts`
- Test: `tests/voucherList.test.ts`

**Interfaces:**
- Consumes: `readVoucherList`, `VoucherList`, `VoucherEntry` from Task 2.
- Produces:
  - `type VoucherStatus = 'ok' | 'not_found' | 'ambiguous' | 'unpaid' | 'cancelled' | 'redeemed'`
  - `interface VoucherLookup { status: VoucherStatus; entry: VoucherEntry | null }`
  - `lookupVoucher(list: VoucherList, raw: string): VoucherLookup`
  - `loadVoucherList(filePath: string): Promise<VoucherList>` — mtime/size cached
  - `clearVoucherListCache(): void`

- [ ] **Step 1: Write the failing test**

Append to `tests/voucherList.test.ts`:

```ts
import { promises as fsp } from 'fs'
import { clearVoucherListCache, loadVoucherList, lookupVoucher } from '../src/server/voucherList'

async function listOf(rows: Parameters<typeof writeVoucherFile>[0]) {
  return readVoucherList(await writeVoucherFile(rows))
}

test('a paid, unredeemed voucher is ok', async () => {
  const list = await listOf([{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' }])
  expect(lookupVoucher(list, '26-1').status).toBe('ok')
})

test('an unpaid voucher is not valid', async () => {
  const list = await listOf([{ lfdNr: '26-007', einzahlDat: null, art: 'Tandem' }])
  expect(lookupVoucher(list, '26-007').status).toBe('unpaid')
})

test('text in EinzahlDat means cancelled, and the text is handed on', async () => {
  const list = await listOf([{ lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' }])
  const result = lookupVoucher(list, '26-009')
  expect(result.status).toBe('cancelled')
  expect(result.entry?.paidText).toBe('STORNO')
})

test('any other text is cancelled too, not quietly accepted', async () => {
  const list = await listOf([{ lfdNr: '26-010', einzahlDat: 'zurückgezahlt', art: 'Tandem' }])
  expect(lookupVoucher(list, '26-010').status).toBe('cancelled')
})

test('a voucher with a redemption date is already used', async () => {
  const list = await listOf([{
    lfdNr: '26-002', einzahlDat: new Date('2026-01-14'),
    art: 'Tandem', eingeloest: new Date('2026-07-12'),
  }])
  const result = lookupVoucher(list, '26-002')
  expect(result.status).toBe('redeemed')
  expect(result.entry?.redeemedAt?.toISOString().slice(0, 10)).toBe('2026-07-12')
})

test('an unknown number is not found, and an empty one is not looked up', async () => {
  const list = await listOf([{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14') }])
  expect(lookupVoucher(list, '99-999').status).toBe('not_found')
  expect(lookupVoucher(list, '   ').status).toBe('not_found')
})

test('two matching rows are ambiguous rather than a guess', async () => {
  const list = await listOf([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14') },
    { lfdNr: '26-1', einzahlDat: new Date('2026-02-14') },
  ])
  const result = lookupVoucher(list, '26-001')
  expect(result.status).toBe('ambiguous')
  expect(result.entry).toBeNull()
})

test('the list is cached until the file changes on disk', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([{ lfdNr: '26-001', einzahlDat: new Date('2026-01-14') }])

  const first = await loadVoucherList(file)
  const second = await loadVoucherList(file)
  // Same object: a OneDrive file must not be re-parsed on every keystroke.
  expect(second).toBe(first)

  // Rewriting it with a second voucher must be picked up without a restart.
  await new Promise((resolve) => setTimeout(resolve, 20))
  const rewritten = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14') },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15') },
  ])
  await fsp.copyFile(rewritten, file)

  const third = await loadVoucherList(file)
  expect(third).not.toBe(first)
  expect(third.byNumber.size).toBe(2)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/voucherList.test.ts`
Expected: FAIL — `lookupVoucher is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/server/voucherList.ts`:

```ts
import { promises as fs } from 'fs'

export type VoucherStatus =
  | 'ok'
  | 'not_found'
  | 'ambiguous'
  | 'unpaid'
  | 'cancelled'
  | 'redeemed'

export interface VoucherLookup {
  status: VoucherStatus
  /** Null when nothing could be identified — not found, or more than one match. */
  entry: VoucherEntry | null
}

export function lookupVoucher(list: VoucherList, raw: string): VoucherLookup {
  const key = normaliseVoucherNumber(raw)
  if (key.length === 0) return { status: 'not_found', entry: null }

  const matches = list.byNumber.get(key)
  if (!matches || matches.length === 0) return { status: 'not_found', entry: null }
  // Picking one of two would be a guess about the club's money.
  if (matches.length > 1) return { status: 'ambiguous', entry: null }

  const entry = matches[0]
  if (entry.paidText !== null) return { status: 'cancelled', entry }
  if (entry.paidAt === null) return { status: 'unpaid', entry }
  if (entry.redeemedAt !== null) return { status: 'redeemed', entry }
  return { status: 'ok', entry }
}

// Parsing the workbook costs real time and the manifest asks after every pause
// in typing. The cache is keyed on what a changed file changes — path, mtime and
// size — so an edit the club makes mid-day still arrives without a restart.
let cache: { path: string; mtimeMs: number; size: number; list: VoucherList } | null = null

export function clearVoucherListCache(): void {
  cache = null
}

export async function loadVoucherList(filePath: string): Promise<VoucherList> {
  const stat = await fs.stat(filePath)
  if (
    cache &&
    cache.path === filePath &&
    cache.mtimeMs === stat.mtimeMs &&
    cache.size === stat.size
  ) {
    return cache.list
  }
  const list = await readVoucherList(filePath)
  cache = { path: filePath, mtimeMs: stat.mtimeMs, size: stat.size, list }
  return list
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/voucherList.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/voucherList.ts tests/voucherList.test.ts
git commit -m "Cache the voucher list and derive a status from a lookup"
```

---

### Task 4: The `voucherListPath` setting

**Files:**
- Modify: `src/server/config.ts:42-49` (the `Config` interface) and its `loadConfig` default
- Modify: `tests/helpers/testServer.ts`
- Modify: `web/manifest/src/api.ts` (`Settings` interface)
- Modify: `web/manifest/src/Settings.tsx`
- Modify: `web/manifest/src/Settings.test.tsx`, `web/manifest/src/Betraege.test.tsx`, `web/manifest/src/Stammdaten.test.tsx`, `web/manifest/src/Detail.test.tsx` (the `SettingsType` fixtures each need the new key)
- Test: `tests/settings.test.ts`

**Interfaces:**
- Produces: `Config.voucherListPath: string` — `''` means the feature is off.

- [ ] **Step 1: Write the failing test**

Append to `tests/settings.test.ts`:

```ts
test('the voucher list path round-trips through the settings', async () => {
  const { app } = testServer()
  const res = await app.inject({
    method: 'PUT', url: '/api/settings',
    payload: { voucherListPath: 'C:/Verein/Tandemliste.xlsx' },
  })
  expect(res.statusCode).toBe(200)
  expect(res.json().voucherListPath).toBe('C:/Verein/Tandemliste.xlsx')
  await app.close()
})

test('the voucher list path starts out empty, which switches the feature off', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().voucherListPath).toBe('')
  await app.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `expected undefined to be ''`.

- [ ] **Step 3: Add the setting to the config**

In `src/server/config.ts`, inside `interface Config`, after `privacyText`:

```ts
  // Absolute path to the club's Tandemliste.xlsx. Empty means the manifest does
  // not check vouchers at all — a club without that file should never be shown
  // machinery it did not ask for.
  voucherListPath: string
```

In `loadConfig`, extend the `def` object:

```ts
  const def: Config = {
    exportDir: dir, contractText: CONTRACT_TEXT, privacyText: PRIVACY_TEXT,
    jumpLocation: '', backupDir: '', voucherListPath: '',
    prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
  }
```

In `tests/helpers/testServer.ts`, add to the config literal after `backupDir: ''`:

```ts
      voucherListPath: '',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the field to the settings screen**

In `web/manifest/src/api.ts`, add to `interface Settings` after `backupDir: string`:

```ts
  voucherListPath: string
```

In `web/manifest/src/Settings.tsx`: add the state, extend `applySettings`, include it in the save, and render the field.

```tsx
  const [voucherListPath, setVoucherListPath] = useState('')
```

```tsx
  function applySettings(cfg: {
    exportDir: string; jumpLocation: string; backupDir: string
    contractText: string; privacyText: string; voucherListPath: string
  }) {
    setExportDir(cfg.exportDir)
    setJumpLocation(cfg.jumpLocation)
    setBackupDir(cfg.backupDir)
    setContractText(cfg.contractText)
    setPrivacyText(cfg.privacyText)
    setVoucherListPath(cfg.voucherListPath)
  }
```

```tsx
      const cfg = await putSettings({
        exportDir, jumpLocation, backupDir, contractText, privacyText, voucherListPath,
      })
```

Render it directly after the backup directory field:

```tsx
      <label className="field">
        Gutscheinliste (Excel-Datei)
        <input
          type="text"
          value={voucherListPath}
          onChange={(e) => {
            setVoucherListPath(e.target.value)
            setSaved(false)
          }}
        />
        <span className="field-hint">
          Vollständiger Pfad zur Tandemliste des Vereins. Leer lassen, wenn keine
          Gutscheinprüfung gewünscht ist.
        </span>
      </label>
```

- [ ] **Step 6: Update the manifest test fixtures**

Add `voucherListPath: '',` to the `CONFIG` object in `web/manifest/src/Settings.test.tsx`, `web/manifest/src/Betraege.test.tsx` and `web/manifest/src/Stammdaten.test.tsx`, and to the inline `getSettings` mock in `web/manifest/src/Detail.test.tsx:85`.

In `Settings.test.tsx`, the "saves the directories" test compares the whole payload — add the key there too:

```ts
    expect(vi.mocked(api.putSettings).mock.calls[0][0]).toEqual({
      exportDir: 'C:/Tandem', jumpLocation: 'Linz', backupDir: '',
      contractText: 'Beförderungsvertrag …', privacyText: 'Datenschutzinformation …',
      voucherListPath: '',
    })
```

- [ ] **Step 7: Run all suites**

Run: `npx vitest run` — Expected: PASS.
Run: `npm --prefix web/manifest test` — Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server/config.ts tests/helpers/testServer.ts tests/settings.test.ts web/manifest/src
git commit -m "Add a configurable path to the club's voucher list"
```

---

### Task 5: The check endpoint

**Files:**
- Create: `src/server/routes/voucher.ts`
- Modify: `src/server/index.ts:20-26`
- Test: `tests/voucher-route.test.ts`

**Interfaces:**
- Consumes: `loadVoucherList`, `lookupVoucher`, `VoucherStatus` from Task 3; `Config.voucherListPath` from Task 4.
- Produces: `GET /api/voucher?number=26-001` returning

```ts
{
  configured: boolean          // false when voucherListPath is empty
  readable: boolean            // false when the file could not be parsed
  status: VoucherStatus | null // null when !configured || !readable
  number: string | null        // as written in the sheet
  paidAt: string | null        // ISO date
  paidText: string | null
  amount: number | null
  art: string | null
  service: 'jump' | 'jump_video' | 'jump_video_photo' | null
  isAddOn: boolean
  redeemedAt: string | null    // ISO date
  error: string | null         // German message when !readable
}
```

- [ ] **Step 1: Write the failing test**

Create `tests/voucher-route.test.ts`:

```ts
import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'
import { writeVoucherFile } from './helpers/voucherFile'
import { clearVoucherListCache } from '../src/server/voucherList'

async function serverWithList(rows: Parameters<typeof writeVoucherFile>[0]) {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile(rows)
  return testServer({ voucherListPath })
}

test('reports a paid, unredeemed voucher with its details', async () => {
  const { app } = await serverWithList([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem + Video', betrag: 355 },
  ])
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-1' })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({
    configured: true, readable: true, status: 'ok',
    number: '26-001', amount: 355, art: 'Tandem + Video',
    service: 'jump_video', isAddOn: false, redeemedAt: null,
  })
  expect(res.json().paidAt).toContain('2026-01-14')
  await app.close()
})

test('reports unpaid, cancelled and unknown vouchers', async () => {
  const { app } = await serverWithList([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' },
  ])
  const status = async (number: string) =>
    (await app.inject({ method: 'GET', url: `/api/voucher?number=${number}` })).json()

  expect((await status('26-007')).status).toBe('unpaid')
  expect((await status('26-009'))).toMatchObject({ status: 'cancelled', paidText: 'STORNO' })
  expect((await status('99-999')).status).toBe('not_found')
  await app.close()
})

test('an unset path reports the feature as switched off, not as an error', async () => {
  const { app } = testServer({ voucherListPath: '' })
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-001' })

  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({ configured: false, readable: false, status: null })
  await app.close()
})

test('an unreadable file reports a German message and never a 500', async () => {
  clearVoucherListCache()
  const { app } = testServer({ voucherListPath: 'C:/nope/keine-datei.xlsx' })
  const res = await app.inject({ method: 'GET', url: '/api/voucher?number=26-001' })

  expect(res.statusCode).toBe(200)
  expect(res.json().configured).toBe(true)
  expect(res.json().readable).toBe(false)
  expect(typeof res.json().error).toBe('string')
  await app.close()
})

test('a missing number is rejected without touching the file', async () => {
  const { app } = testServer({ voucherListPath: '' })
  const res = await app.inject({ method: 'GET', url: '/api/voucher' })
  expect(res.statusCode).toBe(400)
  await app.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/voucher-route.test.ts`
Expected: FAIL — 404 for `/api/voucher`.

- [ ] **Step 3: Write the route**

Create `src/server/routes/voucher.ts`:

```ts
import { FastifyInstance } from 'fastify'
import { loadVoucherList, lookupVoucher } from '../voucherList'
import type { VoucherEntry, VoucherStatus } from '../voucherList'
import type { Config } from '../config'

export interface VoucherCheck {
  configured: boolean
  readable: boolean
  status: VoucherStatus | null
  number: string | null
  paidAt: string | null
  paidText: string | null
  amount: number | null
  art: string | null
  service: VoucherEntry['service']
  isAddOn: boolean
  redeemedAt: string | null
  error: string | null
}

const OFF: VoucherCheck = {
  configured: false, readable: false, status: null, number: null,
  paidAt: null, paidText: null, amount: null, art: null,
  service: null, isAddOn: false, redeemedAt: null, error: null,
}

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

// Every failure here is reported as data, never as a status code the manifest
// would have to treat as broken: an unreadable voucher list is a message beside
// a field, not a reason to stop taking registrations.
export async function checkVoucher(cfg: Config, number: string): Promise<VoucherCheck> {
  const path = cfg.voucherListPath?.trim()
  if (!path) return { ...OFF }

  let list
  try {
    list = await loadVoucherList(path)
  } catch (err) {
    return {
      ...OFF,
      configured: true,
      error: err instanceof Error ? err.message : 'Gutscheinliste nicht lesbar.',
    }
  }

  const { status, entry } = lookupVoucher(list, number)
  return {
    configured: true,
    readable: true,
    status,
    number: entry?.number ?? null,
    paidAt: isoDate(entry?.paidAt ?? null),
    paidText: entry?.paidText ?? null,
    amount: entry?.amount ?? null,
    art: entry?.art ?? null,
    service: entry?.service ?? null,
    isAddOn: entry?.isAddOn ?? false,
    redeemedAt: isoDate(entry?.redeemedAt ?? null),
    error: null,
  }
}

export function registerVoucherRoutes(app: FastifyInstance, cfgRef: { current: Config }) {
  app.get('/api/voucher', async (req, reply) => {
    const number = (req.query as any)?.number
    if (typeof number !== 'string' || number.trim().length === 0) {
      return reply.code(400).send({ error: 'Gutschein-Nr. fehlt' })
    }
    return reply.send(await checkVoucher(cfgRef.current, number))
  })
}
```

In `src/server/index.ts`, import and register it beside the others:

```ts
import { registerVoucherRoutes } from './routes/voucher'
```

```ts
  registerVoucherRoutes(app, cfgRef)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/voucher-route.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/voucher.ts src/server/index.ts tests/voucher-route.test.ts
git commit -m "Serve a voucher check from the club's list"
```

---

### Task 6: The status line in the manifest

**Files:**
- Create: `web/manifest/src/voucher.ts`
- Modify: `web/manifest/src/Detail.tsx` (the `showVoucherNumber` fieldset, around lines 247-310)
- Modify: `web/manifest/src/index.css` (reuse `.voucher-status`)
- Test: `web/manifest/src/Detail.test.tsx`

**Interfaces:**
- Consumes: `GET /api/voucher` from Task 5.
- Produces:
  - `interface VoucherCheck` (mirrors the server's response shape exactly)
  - `checkVoucher(number: string): Promise<VoucherCheck>`
  - `voucherStatusText(check: VoucherCheck, chosen: VoucherService | ''): { text: string; tone: 'ok' | 'warn' | 'muted' } | null`

- [ ] **Step 1: Write the failing test**

Append to `web/manifest/src/Detail.test.tsx`. Add `checkVoucher: vi.fn()` to the `vi.mock('./api', …)` factory first, then:

```tsx
  const OK_CHECK = {
    configured: true, readable: true, status: 'ok' as const, number: '26-001',
    paidAt: '2026-01-14', paidText: null, amount: 355, art: 'Tandem + Video',
    service: 'jump_video' as const, isAddOn: false, redeemedAt: null, error: null,
  }

  async function typeVoucherNumber(user: ReturnType<typeof userEvent.setup>, number: string) {
    await user.selectOptions(screen.getByLabelText('Zahlungsart'), 'voucher')
    await user.type(screen.getByLabelText('Gutschein-Nr.'), number)
  }

  it('says a voucher is paid and still unused', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')

    expect(await screen.findByText(/Bezahlt am 14\.01\.2026/)).toBeInTheDocument()
  })

  it('warns about an unpaid voucher without locking anything', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({ ...OK_CHECK, status: 'unpaid', paidAt: null })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-007')

    expect(await screen.findByText(/Nicht bezahlt/)).toBeInTheDocument()
    // The operator is standing in front of the guest; the software does not decide.
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled()
  })

  it('quotes whatever text stands in EinzahlDat', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({
      ...OK_CHECK, status: 'cancelled', paidAt: null, paidText: 'STORNO',
    })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-009')

    expect(await screen.findByText(/STORNO/)).toBeInTheDocument()
  })

  it('says when a voucher was already redeemed', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({
      ...OK_CHECK, status: 'redeemed', redeemedAt: '2026-07-12',
    })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-002')

    expect(await screen.findByText(/Bereits eingelöst am 12\.07\.2026/)).toBeInTheDocument()
  })

  it('points out an Art that does not match the chosen Leistung', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')
    await screen.findByText(/Bezahlt am/)
    await user.selectOptions(screen.getByLabelText(/Gutschein-Leistung/), 'jump')

    expect(await screen.findByText(/Laut Liste: Tandem \+ Video/)).toBeInTheDocument()
  })

  it('shows the amount then and now, without calling the gap a problem', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue(OK_CHECK)
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')

    // 355 € paid then, 270 + 100 at today's table. Every older voucher is below
    // today's price; that is the club's arrangement, so it is stated, not flagged.
    const line = await screen.findByText(/355 € damals/)
    expect(line.textContent).toContain('370 € heute')
    expect(line.className).not.toContain('warn')
  })

  it('says nothing at all when no list is configured', async () => {
    const user = userEvent.setup()
    vi.mocked(api.checkVoucher).mockResolvedValue({
      ...OK_CHECK, configured: false, readable: false, status: null,
    })
    renderDetail()
    await screen.findByText('Zu kassieren')

    await typeVoucherNumber(user, '26-001')

    expect(screen.queryByText(/Gutscheinliste/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Bezahlt am/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web/manifest test`
Expected: FAIL — `api.checkVoucher is not a function`.

- [ ] **Step 3: Write the client module**

Create `web/manifest/src/voucher.ts`:

```ts
import type { VoucherService } from './api'

export type VoucherStatus =
  | 'ok' | 'not_found' | 'ambiguous' | 'unpaid' | 'cancelled' | 'redeemed'

/** Mirrors the response of GET /api/voucher (src/server/routes/voucher.ts). */
export interface VoucherCheck {
  configured: boolean
  readable: boolean
  status: VoucherStatus | null
  number: string | null
  paidAt: string | null
  paidText: string | null
  amount: number | null
  art: string | null
  service: VoucherService | null
  isAddOn: boolean
  redeemedAt: string | null
  error: string | null
}

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const [year, month, day] = iso.slice(0, 10).split('-')
  return `${day}.${month}.${year}`
}

export interface StatusLine {
  text: string
  tone: 'ok' | 'warn' | 'muted'
}

// One line, one job: say what the club's list knows about this number. A missing
// list is muted rather than a warning — the club that configured no file has
// nothing to fix.
export function voucherStatusText(check: VoucherCheck): StatusLine | null {
  if (!check.configured) return null
  if (!check.readable) {
    return { text: check.error ?? 'Gutscheinliste nicht lesbar.', tone: 'muted' }
  }
  switch (check.status) {
    case 'ok':
      return { text: `Bezahlt am ${formatDate(check.paidAt)}, noch nicht eingelöst.`, tone: 'ok' }
    case 'unpaid':
      return { text: 'Nicht bezahlt — Gutschein ist nicht gültig.', tone: 'warn' }
    case 'cancelled':
      return { text: `Storniert („${check.paidText}").`, tone: 'warn' }
    case 'redeemed':
      return { text: `Bereits eingelöst am ${formatDate(check.redeemedAt)}.`, tone: 'warn' }
    case 'ambiguous':
      return { text: 'Mehrere Gutscheine passen zu dieser Nummer.', tone: 'warn' }
    case 'not_found':
      return { text: 'Nummer nicht in der Gutscheinliste.', tone: 'warn' }
    default:
      return null
  }
}

// Separate from the status: what the voucher covers is a different question from
// whether it is valid, and both can be wrong at once.
export function voucherServiceText(
  check: VoucherCheck,
  chosen: VoucherService | ''
): StatusLine | null {
  if (!check.configured || !check.readable || !check.art) return null
  if (check.isAddOn) {
    return { text: `Laut Liste: ${check.art} — deckt keinen Sprung ab.`, tone: 'muted' }
  }
  // No mapping means nothing to compare against; better mute than wrong.
  if (!check.service || chosen === '' || check.service === chosen) return null
  return { text: `Laut Liste: ${check.art}.`, tone: 'warn' }
}

// Shown, never compared. Every voucher the club issued before the last price
// rise is below today's value — that is the arrangement, not a fault, so this
// line is plain information and carries no tone of alarm.
export function voucherAmountText(
  check: VoucherCheck,
  valueToday: number | null,
  formatEuro: (amount: number) => string
): StatusLine | null {
  if (!check.configured || !check.readable || check.amount === null) return null
  const today = valueToday === null ? '' : ` · ${formatEuro(valueToday)} heute`
  return { text: `${formatEuro(check.amount)} damals${today}`, tone: 'muted' }
}
```

In `web/manifest/src/api.ts`, add the fetch (and re-export the type so `Detail.tsx` has one import):

```ts
import type { VoucherCheck } from './voucher'
export type { VoucherCheck } from './voucher'

export async function checkVoucher(number: string): Promise<VoucherCheck> {
  const res = await fetch(apiUrl(`/api/voucher?number=${encodeURIComponent(number)}`))
  if (!res.ok) throw new Error('Gutschein konnte nicht geprüft werden')
  return asJson<VoucherCheck>(res)
}
```

- [ ] **Step 4: Wire it into the detail screen**

In `web/manifest/src/Detail.tsx`, add the import:

```tsx
import { checkVoucher } from './api'
import type { VoucherCheck } from './api'
import { voucherServiceText, voucherStatusText } from './voucher'
```

Add state beside the other voucher state:

```tsx
  const [voucherCheck, setVoucherCheck] = useState<VoucherCheck | null>(null)
```

Add the debounced lookup after the existing effects:

```tsx
  // Checked shortly after typing stops, not per keystroke: the club's list may
  // live in OneDrive. The server caches it against the file's mtime, so a repeat
  // check of the same number costs nothing.
  useEffect(() => {
    const number = voucherNumber.trim()
    if (!showVoucherNumber || number.length === 0) {
      setVoucherCheck(null)
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      checkVoucher(number)
        .then((result) => { if (!cancelled) setVoucherCheck(result) })
        .catch(() => { if (!cancelled) setVoucherCheck(null) })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [voucherNumber, showVoucherNumber])

  const voucherLine = voucherCheck ? voucherStatusText(voucherCheck) : null
  const voucherArtLine = voucherCheck ? voucherServiceText(voucherCheck, voucherService) : null
  // What the same service is worth at today's table, for the "damals · heute"
  // line. `voucherValue` is already imported by this screen's pricing helpers.
  const voucherAmountLine =
    voucherCheck && prices
      ? voucherAmountText(
          voucherCheck,
          voucherCheck.service ? voucherValue(voucherCheck.service, prices) : null,
          formatEuro
        )
      : null
```

Extend the pricing import at the top of `Detail.tsx` to include `voucherValue`:

```tsx
import {
  atLeast, formatEuro, priceLines, serviceOfVoucher, surchargeForWeight, voucherValue,
} from './pricing'
```

and the voucher import:

```tsx
import { voucherAmountText, voucherServiceText, voucherStatusText } from './voucher'
```

Render both lines directly under the Gutschein-Nr. field, inside the existing `fieldset`:

```tsx
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
```

Add to `web/manifest/src/index.css`, after the `.field-hint.warn` rule:

```css
/* The club's list disagrees with what was typed — worth seeing, never blocking. */
.voucher-check.warn {
  color: var(--ember);
  font-weight: 600;
  opacity: 1;
}

.voucher-check.ok {
  color: var(--text-h);
  opacity: 0.9;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web/manifest test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/manifest/src
git commit -m "Show what the club's list says about a typed voucher number"
```

---

### Task 7: Writing the redemption date

**Files:**
- Create: `src/server/voucherRedeem.ts`
- Modify: `src/server/db.ts` (table + migration list)
- Modify: `src/server/routes/registrations.ts` (the PATCH handler, after `paid_at` is decided)
- Modify: `tests/db.test.ts` (column list, twice)
- Modify: `web/manifest/src/api.ts` (`Registration`)
- Test: `tests/voucherRedeem.test.ts`

**Interfaces:**
- Consumes: `loadVoucherList`, `lookupVoucher`, `clearVoucherListCache` from Task 3; `Config.voucherListPath` from Task 4.
- Produces:
  - `type RedeemOutcome = 'written' | 'already_redeemed' | 'invalid' | 'failed' | 'disabled'`
  - `redeemVoucher(cfg: Config, number: string, on: Date): Promise<RedeemOutcome>`
  - DB columns `voucher_redeemed_at TEXT`, `voucher_redeem_synced_at TEXT`

- [ ] **Step 1: Write the failing test**

Create `tests/voucherRedeem.test.ts`:

```ts
import { test, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { redeemVoucher } from '../src/server/voucherRedeem'
import { clearVoucherListCache } from '../src/server/voucherList'
import { writeVoucherFile } from './helpers/voucherFile'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'
import type { Config } from '../src/server/config'

async function configFor(voucherListPath: string): Promise<Config> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-redeem-'))
  return {
    exportDir: dir, contractText: '', privacyText: '', jumpLocation: '',
    backupDir: '', voucherListPath,
    prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
  }
}

async function cellValue(file: string, row: number, header: string) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)
  const ws = wb.worksheets[0]
  const headers = ws.getRow(1).values as string[]
  return ws.getRow(row).getCell(headers.indexOf(header)).value
}

test('writes the redemption date into the Eingelöst cell', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))).toBe('written')
  const written = await cellValue(file, 2, 'Eingelöst')
  expect(written instanceof Date && written.toISOString().slice(0, 10)).toBe('2026-08-10')
})

test('a date already in the cell is left exactly as it is', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    {
      lfdNr: '26-002', einzahlDat: new Date('2026-01-14'), art: 'Tandem',
      eingeloest: new Date('2026-07-12'),
    },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-002', new Date('2026-08-10'))).toBe('already_redeemed')
  const kept = await cellValue(file, 2, 'Eingelöst')
  expect(kept instanceof Date && kept.toISOString().slice(0, 10)).toBe('2026-07-12')
})

test('an invalid voucher is never marked as redeemed', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
    { lfdNr: '26-009', einzahlDat: 'STORNO', art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  expect(await redeemVoucher(cfg, '26-007', new Date('2026-08-10'))).toBe('invalid')
  expect(await redeemVoucher(cfg, '26-009', new Date('2026-08-10'))).toBe('invalid')
  expect(await redeemVoucher(cfg, '99-999', new Date('2026-08-10'))).toBe('invalid')
  expect(await cellValue(file, 2, 'Eingelöst')).toBeNull()
  expect(await cellValue(file, 3, 'Eingelöst')).toBeNull()
})

test('the list is backed up once a day, not once per write', async () => {
  clearVoucherListCache()
  const file = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
    { lfdNr: '26-002', einzahlDat: new Date('2026-01-15'), art: 'Tandem' },
  ])
  const cfg = await configFor(file)

  await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))
  await redeemVoucher(cfg, '26-002', new Date('2026-08-10'))

  const backups = await fs.readdir(path.join(cfg.exportDir, 'Gutschein-Backup'))
  expect(backups).toEqual(['Tandemliste_2026-08-10.xlsx'])
})

test('an unreadable list is a technical failure, to be retried', async () => {
  clearVoucherListCache()
  const cfg = await configFor('C:/nope/keine-datei.xlsx')
  expect(await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))).toBe('failed')
})

test('no configured list means nothing to do', async () => {
  const cfg = await configFor('')
  expect(await redeemVoucher(cfg, '26-001', new Date('2026-08-10'))).toBe('disabled')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/voucherRedeem.test.ts`
Expected: FAIL — cannot resolve `../src/server/voucherRedeem`.

- [ ] **Step 3: Write the writer**

Create `src/server/voucherRedeem.ts`:

```ts
import ExcelJS from 'exceljs'
import { promises as fs } from 'fs'
import path from 'path'
import { clearVoucherListCache, loadVoucherList, lookupVoucher } from './voucherList'
import type { Config } from './config'

export type RedeemOutcome =
  /** The date reached the Eingelöst cell. */
  | 'written'
  /** Someone had already entered a date; it was left alone. */
  | 'already_redeemed'
  /** Unpaid, cancelled, unknown or ambiguous — nothing was written or claimed. */
  | 'invalid'
  /** File locked, missing or unreadable. Worth retrying. */
  | 'failed'
  /** No voucher list configured. */
  | 'disabled'

const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// One copy per day, before the first change of that day. The sheet is plain
// enough that an ExcelJS round-trip is low risk, but this is the club's only
// record of which vouchers it sold.
async function backupOnce(cfg: Config, filePath: string, on: Date): Promise<void> {
  const dir = path.join(cfg.backupDir?.trim() || cfg.exportDir, 'Gutschein-Backup')
  await fs.mkdir(dir, { recursive: true })
  const target = path.join(dir, `Tandemliste_${isoDay(on)}.xlsx`)
  try {
    // 'wx' fails with EEXIST if today's copy is already there, which makes the
    // check and the write one operation rather than two racing ones.
    const handle = await fs.open(target, 'wx')
    try {
      await handle.writeFile(await fs.readFile(filePath))
    } finally {
      await handle.close()
    }
  } catch (err: any) {
    if (err.code !== 'EEXIST') throw err
  }
}

function eingeloestColumn(sheet: ExcelJS.Worksheet): number | null {
  const header = sheet.getRow(1)
  for (let c = 1; c <= sheet.columnCount; c++) {
    const value = header.getCell(c).value
    if (value === null || value === undefined) continue
    const key = String(value).trim().toLowerCase().replace('eingeloest', 'eingelöst')
    if (key === 'eingelöst') return c
  }
  return null
}

export async function redeemVoucher(
  cfg: Config,
  number: string,
  on: Date
): Promise<RedeemOutcome> {
  const filePath = cfg.voucherListPath?.trim()
  if (!filePath) return 'disabled'

  let entry
  try {
    const list = await loadVoucherList(filePath)
    const found = lookupVoucher(list, number)
    // Only a voucher the list calls good gets a date. An unpaid or cancelled one
    // must not be marked used, and an ambiguous one must not have a row guessed.
    if (found.status === 'redeemed') return 'already_redeemed'
    if (found.status !== 'ok' || !found.entry) return 'invalid'
    entry = found.entry
  } catch {
    return 'failed'
  }

  try {
    await backupOnce(cfg, filePath, on)

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(filePath)
    const sheet = wb.worksheets[0]
    const column = eingeloestColumn(sheet)
    if (!sheet || column === null) return 'failed'

    const cell = sheet.getRow(entry.rowNumber).getCell(column)
    // Re-checked against the file itself, not only against the cached read: the
    // club may have entered a date since the list was last parsed.
    if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
      return 'already_redeemed'
    }
    cell.value = on
    cell.numFmt = 'dd.mm.yyyy'

    await wb.xlsx.writeFile(filePath)
    // The file on disk changed, so the parsed copy is stale.
    clearVoucherListCache()
    return 'written'
  } catch {
    // Locked by Excel, mid-sync in OneDrive, read-only share: all retryable.
    return 'failed'
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/voucherRedeem.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the two columns**

In `src/server/db.ts`, extend the `CREATE TABLE` line:

```sql
      paid_at TEXT, notes TEXT, privacy_ack_at TEXT,
      voucher_redeemed_at TEXT, voucher_redeem_synced_at TEXT
```

and the migration list, after `['privacy_ack_at', 'TEXT'],`:

```ts
    // When we decided the voucher was used, and when that reached the club's
    // Excel file. Both NULL on an old row: it predates the voucher check.
    ['voucher_redeemed_at', 'TEXT'],
    ['voucher_redeem_synced_at', 'TEXT'],
```

In `tests/db.test.ts`, add `'voucher_redeemed_at', 'voucher_redeem_synced_at'` to the `expectedColumns` array and to the migration test's list of added columns.

In `web/manifest/src/api.ts`, add to `interface Registration`:

```ts
  voucher_redeemed_at: string | null
  voucher_redeem_synced_at: string | null
```

Add `voucher_redeemed_at: null, voucher_redeem_synced_at: null,` to the `makeRegistration` fixtures in `web/manifest/src/Detail.test.tsx`, `web/manifest/src/List.test.tsx` and `web/manifest/src/Urkunde.test.tsx`.

- [ ] **Step 6: Redeem when a voucher row is collected**

In `src/server/routes/registrations.ts`, add the import:

```ts
import { redeemVoucher } from '../voucherRedeem'
```

In the PATCH handler, after the `UPDATE` has run and before `sse.broadcast('changed', { id })`, add:

```ts
      // Collecting a voucher row is the moment it is spent. The write into the
      // club's file is attempted now; if it fails, the row keeps
      // voucher_redeemed_at without a sync stamp and the export retries it.
      const after = db.prepare('SELECT * FROM registrations WHERE id=?').get(id) as any
      if (paid === true && after.payment_method === 'voucher' && after.voucher_number) {
        const outcome = await redeemVoucher(cfgRef.current, after.voucher_number, new Date())
        if (outcome === 'written') {
          db.prepare(`UPDATE registrations
            SET voucher_redeemed_at=@now, voucher_redeem_synced_at=@now WHERE id=@id`)
            .run({ id, now: new Date().toISOString() })
        } else if (outcome === 'failed') {
          // Ours to remember; the file gets it later.
          db.prepare('UPDATE registrations SET voucher_redeemed_at=@now WHERE id=@id')
            .run({ id, now: new Date().toISOString() })
        }
        // 'invalid', 'already_redeemed' and 'disabled' claim nothing: an invalid
        // voucher must not sit in a retry queue that then never empties.
      }
      // Putting a row back to open drops a redemption that never reached the
      // file. One that did is left alone — silently deleting a date from the
      // club's list is worse than a stale one a human can correct.
      if (paid === false) {
        db.prepare(`UPDATE registrations SET voucher_redeemed_at=NULL
          WHERE id=@id AND voucher_redeem_synced_at IS NULL`).run({ id })
      }
```

- [ ] **Step 7: Run the whole server suite**

Run: `npx vitest run`
Expected: PASS.
Run: `npm --prefix web/manifest test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/server tests web/manifest/src
git commit -m "Write the redemption date back into the club's voucher list"
```

---

### Task 8: The export sweep and the pending banner

**Files:**
- Modify: `src/server/routes/export.ts`
- Modify: `src/server/routes/voucher.ts` (add `GET /api/voucher/pending`)
- Modify: `web/manifest/src/api.ts` (`ExportResult`, `pendingRedemptions`)
- Modify: `web/manifest/src/List.tsx:221-232, 260-270`
- Modify: `tests/helpers/testServer.ts` (return the database too)
- Test: `tests/export.test.ts` (local `makeCfgRef` pattern — see the note in Step 1), `tests/voucher-route.test.ts`, `web/manifest/src/List.test.tsx`

**Interfaces:**
- Consumes: `redeemVoucher` from Task 7.
- Produces:
  - `ExportResult` gains `redemptionsWritten: number`, `redemptionsPending: number`, `redemptionsInvalid: number`
  - `GET /api/voucher/pending` → `{ count: number }`
  - `pendingRedemptions(): Promise<{ count: number }>` in the manifest api

- [ ] **Step 1: Write the failing test**

Append to `tests/export.test.ts`:

```ts
import { writeVoucherFile } from './helpers/voucherFile'
import { clearVoucherListCache } from '../src/server/voucherList'

test('the export writes redemptions that could not be written earlier', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-001', einzahlDat: new Date('2026-01-14'), art: 'Tandem' },
  ])
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-sweep-'))
  const { app, db } = testServer({ exportDir, voucherListPath })

  // A row collected while the file was locked: redeemed for us, not yet written.
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,payment_method,voucher_number,price,
     created_at,jump_date,paid_at,voucher_redeemed_at)
    VALUES ('A','B','voucher','26-001',20,
     '2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z',
     '2026-08-10T10:00:00.000Z')`).run()

  const res = await app.inject({ method: 'POST', url: '/api/export?date=2026-08-10' })

  expect(res.json().redemptionsWritten).toBe(1)
  expect(res.json().redemptionsPending).toBe(0)
  const row = db.prepare('SELECT voucher_redeem_synced_at FROM registrations').get() as any
  expect(row.voucher_redeem_synced_at).not.toBeNull()
  await app.close()
})

test('a voucher that turned invalid leaves the queue instead of blocking it', async () => {
  clearVoucherListCache()
  const voucherListPath = await writeVoucherFile([
    { lfdNr: '26-007', einzahlDat: null, art: 'Tandem' },
  ])
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-sweep-bad-'))
  const { app, db } = testServer({ exportDir, voucherListPath })

  db.prepare(`INSERT INTO registrations
    (first_name,last_name,payment_method,voucher_number,price,
     created_at,jump_date,paid_at,voucher_redeemed_at)
    VALUES ('A','B','voucher','26-007',20,
     '2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z',
     '2026-08-10T10:00:00.000Z')`).run()

  const res = await app.inject({ method: 'POST', url: '/api/export?date=2026-08-10' })

  expect(res.json().redemptionsInvalid).toBe(1)
  expect(res.json().redemptionsPending).toBe(0)
  // Taken back, so it stops being counted as owed to the file.
  const row = db.prepare('SELECT voucher_redeemed_at FROM registrations').get() as any
  expect(row.voucher_redeemed_at).toBeNull()
  await app.close()
})

**Note on the two tests above:** `tests/export.test.ts` does not use the
`testServer` helper — it builds its own Fastify instance, calls `openDb` itself
and assembles a config through the local `makeCfgRef(dir)`. Follow that existing
pattern rather than importing `testServer`: create the app the way the
neighbouring tests in that file do, and extend `makeCfgRef` so the config it
returns carries the new key:

```ts
function makeCfgRef(dir: string, jumpLocation = 'Freistadt', voucherListPath = '') {
  return {
    current: {
      exportDir: dir, contractText: '', privacyText: '', jumpLocation, backupDir: '',
      voucherListPath,
      prices: { ...DEFAULT_PRICES }, payouts: { ...DEFAULT_PAYOUTS },
    },
  }
}
```

Existing callers pass one or two arguments and are unaffected.

The pending-count test belongs with the other route tests, not here. Add it to
`tests/voucher-route.test.ts`:

```ts
test('the pending count is what the manifest shows in its banner', async () => {
  clearVoucherListCache()
  const { app, db } = testServer({ voucherListPath: '' })
  db.prepare(`INSERT INTO registrations
    (first_name,last_name,created_at,jump_date,voucher_redeemed_at)
    VALUES ('A','B','2026-08-10T10:00:00.000Z','2026-08-10','2026-08-10T10:00:00.000Z')`).run()

  const res = await app.inject({ method: 'GET', url: '/api/voucher/pending' })
  expect(res.json().count).toBe(1)
  await app.close()
})
```

`testServer` currently returns `{ app, cfgRef }`. Extend `tests/helpers/testServer.ts`
to build the database first and return it, so that test can seed a row:

```ts
  const db = openDb(':memory:')
  return { app: buildServer(db, cfgRef, templateBytes, undefined, notify), cfgRef, db }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/export.test.ts`
Expected: FAIL — `expected undefined to be 1`.

- [ ] **Step 3: Write the sweep**

In `src/server/routes/export.ts`, add the imports:

```ts
import { redeemVoucher } from '../voucherRedeem'
```

Inside the export handler, after `payoutSections` is computed and before the label loop (the loop overwrites enums, so this must run first):

```ts
    // Every redemption that did not reach the club's file when the row was
    // collected gets one more attempt here. This is the "at latest at export"
    // half of the promise; the collect handler is the other.
    let redemptionsWritten = 0
    let redemptionsPending = 0
    let redemptionsInvalid = 0
    const owed = db.prepare(`SELECT id, voucher_number FROM registrations
      WHERE jump_date=? AND voucher_redeemed_at IS NOT NULL
        AND voucher_redeem_synced_at IS NULL AND voucher_number IS NOT NULL`).all(date) as any[]
    for (const row of owed) {
      const outcome = await redeemVoucher(cfgRef.current, row.voucher_number, new Date())
      if (outcome === 'written' || outcome === 'already_redeemed') {
        db.prepare('UPDATE registrations SET voucher_redeem_synced_at=@now WHERE id=@id')
          .run({ id: row.id, now: new Date().toISOString() })
        redemptionsWritten += 1
      } else if (outcome === 'invalid') {
        // The list says this voucher is not good after all. Take the redemption
        // back so it stops being counted as something the file still owes.
        db.prepare('UPDATE registrations SET voucher_redeemed_at=NULL WHERE id=@id')
          .run({ id: row.id })
        redemptionsInvalid += 1
      } else if (outcome === 'failed') {
        redemptionsPending += 1
      }
    }
```

and extend the response:

```ts
    return reply.send({
      path: filePath, count: rows.length,
      redemptionsWritten, redemptionsPending, redemptionsInvalid,
    })
```

In `src/server/routes/voucher.ts`, the route needs the database. Change the signature and registration:

```ts
export function registerVoucherRoutes(
  app: FastifyInstance,
  db: Database,
  cfgRef: { current: Config }
) {
```

with `import type { Database } from 'better-sqlite3'` at the top, plus the new route:

```ts
  // What the manifest banner counts: redemptions we recorded that the club's
  // file has not received. Invalid vouchers are never in here by construction.
  app.get('/api/voucher/pending', async () => {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM registrations
      WHERE voucher_redeemed_at IS NOT NULL AND voucher_redeem_synced_at IS NULL`)
      .get() as { count: number }
    return { count: row.count }
  })
```

and in `src/server/index.ts`: `registerVoucherRoutes(app, db, cfgRef)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/export.test.ts tests/voucher-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Show it in the manifest**

In `web/manifest/src/api.ts`:

```ts
export interface ExportResult {
  path: string
  count: number
  redemptionsWritten: number
  redemptionsPending: number
  redemptionsInvalid: number
}

export async function pendingRedemptions(): Promise<{ count: number }> {
  const res = await fetch(apiUrl('/api/voucher/pending'))
  if (!res.ok) throw new Error('Offene Einlösungen konnten nicht geladen werden')
  return asJson<{ count: number }>(res)
}
```

In `web/manifest/src/List.tsx`, import `pendingRedemptions`, add state, refresh it whenever the list refreshes, and render a banner above the actions row:

```tsx
  const [pending, setPending] = useState(0)
```

```tsx
  // Refreshed with the list, so a redemption written by the export disappears
  // from the banner without a reload.
  useEffect(() => {
    pendingRedemptions().then((r) => setPending(r.count)).catch(() => {})
  }, [rows])
```

```tsx
      {pending > 0 && (
        <p className="hint warn">
          {pending === 1
            ? '1 Einlösung noch nicht in die Gutscheinliste geschrieben.'
            : `${pending} Einlösungen noch nicht in die Gutscheinliste geschrieben.`}
        </p>
      )}
```

and extend the export message:

```tsx
      const result = await exportDay(date)
      const parts = [`Export erstellt: ${result.path} (${result.count} Einträge)`]
      if (result.redemptionsWritten > 0) {
        parts.push(`${result.redemptionsWritten} Einlösungen eingetragen`)
      }
      if (result.redemptionsPending > 0) {
        parts.push(`${result.redemptionsPending} noch offen`)
      }
      if (result.redemptionsInvalid > 0) {
        parts.push(`${result.redemptionsInvalid} ungültig, nicht eingetragen`)
      }
      setExportMessage(parts.join(' · '))
```

Add `pendingRedemptions: vi.fn()` to the `vi.mock('./api', …)` factory in `web/manifest/src/List.test.tsx`, with `vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 0 })` in `beforeEach`, and a test:

```tsx
  it('says how many redemptions the club list is still missing', async () => {
    vi.mocked(api.pendingRedemptions).mockResolvedValue({ count: 2 })
    render(<List onSelect={vi.fn()} />)

    expect(await screen.findByText(/2 Einlösungen noch nicht/)).toBeInTheDocument()
  })
```

Existing `exportDay` mocks in that file need the three new counters added to their resolved value.

- [ ] **Step 6: Run every suite**

Run: `npx vitest run` — Expected: PASS.
Run: `npm --prefix web/manifest test` — Expected: PASS.
Run: `npm --prefix web/guest test` — Expected: PASS.
Run: `npm run build:web && npx playwright test` — Expected: 1 passed.

- [ ] **Step 7: Commit**

```bash
git add src/server web/manifest/src tests
git commit -m "Retry unwritten redemptions at export and show what is still open"
```

---

## Self-Review

**Spec coverage.** Path setting → Task 4. Header-name lookup and unreadable-file handling → Task 2. Caching → Task 3. Normalising and ambiguity → Tasks 1 and 3. Every status row of the spec's table → Task 3 (server) and Task 6 (line text). Art vs Leistung including the add-on → Tasks 1 and 6. Betrag shown, never compared → Task 6, `voucherAmountText` plus its own test, rendered as a muted third line (this was missing on the first pass and has been added). Write-only-when-valid-and-empty → Task 7. Backup once a day → Task 7. Both triggers → Tasks 7 and 8. Un-collecting → Task 7 Step 6. Pending banner and export counts → Task 8. Never blocking → asserted in Task 6.

**Placeholders.** None: every code step carries the code, every test step the assertions, every run step the command and its expected result.

**Type consistency.** `VoucherStatus`, `VoucherEntry`, `VoucherList`, `VoucherLookup`, `VoucherCheck` and `RedeemOutcome` keep the same members from the task that defines them through every later use. `checkVoucher` names the server helper (Task 5) and the client fetch (Task 6) — same shape on both sides, deliberately. `testServer` gains `db` in Task 8, which Tasks 1-7 do not rely on.
