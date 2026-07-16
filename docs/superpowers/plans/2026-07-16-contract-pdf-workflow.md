# Contract PDF Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the guest kiosk's contract text from the real `Befoerderungsvertrag.pdf`, merge signing into the contract screen (instead of two screens later), and replace the stored signature PNG with a real filled-and-signed copy of that PDF per registration.

**Architecture:** `pdf-lib` overlays guest-entered text and the signature image onto a copy of the shipped PDF template at hardcoded (measured) coordinates — the template is flat text, not an AcroForm. The generated PDF is written to disk under `<exportDir>/vertaege/`; the DB stores only the filename. The guest app's `Contract` screen gains a signature pad and becomes the terminal step before submission; the separate `Sign` screen is removed.

**Tech Stack:** TypeScript, Fastify, better-sqlite3, pdf-lib (new), React 19 + Vite (guest/manifest), Vitest, Playwright.

## Global Constraints

- Vertragstext (exact, extracted from `Befoerderungsvertrag.pdf` pages 1–2, body only) — see Task 2 for the full literal string.
- Signed PDF file path: `<exportDir>/vertaege/<yyyy.mm.dd>_<lastname>-<firstname>.pdf`; on a same-day name collision append ` (2)`, ` (3)`, etc.
- DB stores only the filename (`contract_pdf_filename`), never a path.
- `signature_png` column is dropped, not kept for backward compatibility (app is early-stage, no production data to preserve).
- Tandemmaster and Gutschein-Nr. are left blank on the generated PDF permanently — never regenerated when assigned later in the manifest app.
- All new user-facing strings are German, matching the existing app's tone.
- No new dependency beyond `pdf-lib` (already installed via `npm install pdf-lib`, present in `package.json`).

---

## Task 1: Contract template asset + packaging

**Files:**
- Create: `assets/Befoerderungsvertrag.pdf` (move from repo root)
- Modify: `pkg.config.json`
- Modify: `build.md:130-138` (assets list shown in the docs)

**Interfaces:**
- Produces: a template PDF readable at `<project root>/assets/Befoerderungsvertrag.pdf` in dev, and at `assets/Befoerderungsvertrag.pdf` inside the pkg snapshot (same relative path pkg embeds it at) in the packaged exe.

- [ ] **Step 1: Move the template into `assets/`**

```bash
mkdir -p assets
git mv Befoerderungsvertrag.pdf assets/Befoerderungsvertrag.pdf
```

- [ ] **Step 2: Add it to the pkg asset list**

Modify `pkg.config.json`:

```json
{
  "assets": [
    "web/guest/dist/**/*",
    "web/manifest/dist/**/*",
    "assets/**/*"
  ],
  "outputPath": "dist"
}
```

- [ ] **Step 3: Update the packaging doc's asset list example**

In `build.md`, the fenced example around line 130-138 currently reads:

```jsonc
{
  "assets": [
    "web/guest/dist/**/*",     // guest kiosk app, embedded into the exe
    "web/manifest/dist/**/*"   // manifest/staff app, embedded into the exe
  ],
  "outputPath": "dist"
}
```

Replace it with:

```jsonc
{
  "assets": [
    "web/guest/dist/**/*",     // guest kiosk app, embedded into the exe
    "web/manifest/dist/**/*",  // manifest/staff app, embedded into the exe
    "assets/**/*"              // Befoerderungsvertrag.pdf contract template
  ],
  "outputPath": "dist"
}
```

Directly below that fence, add one sentence: "Unlike the web frontends, the contract template is read with a single `fs.readFileSync` in `main.ts` (see `contractPdf.ts` usage there), so it does not need the extraction-to-tempdir step `@fastify/static` requires."

- [ ] **Step 4: Commit**

```bash
git add assets/Befoerderungsvertrag.pdf pkg.config.json build.md
git commit -m "Move contract template into assets/, embed it for packaging"
```

---

## Task 2: Config — vertragstext default + jumpLocation

**Files:**
- Modify: `src/server/config.ts`
- Modify: `config.example.json`

**Interfaces:**
- Produces: `Config.contractText: string` (now defaults to the real contract body instead of `''`), `Config.jumpLocation: string` (new, defaults to `''`).
- Consumes: nothing new.

- [ ] **Step 1: Replace `src/server/config.ts`**

```ts
import fs from 'fs'
import path from 'path'

export interface Config {
  exportDir: string
  contractText: string
  jumpLocation: string
}

const CONTRACT_TEXT = `Der Tandempassagier erklärt seinen Beitritt beim HFSC-Freistadt als unterstützendes Mitglied. Mit dieser Mitgliedschaft sind keine finanziellen Verpflichtungen verbunden. Die Mitgliedschaft endet automatisch mit Ende des Jahres der Unterfertigung. Bei allen Beförderungen von Personen und Sachen mit dem vom HFSC-Freistadt gehaltenen und betriebenen Tandemfallschirmen fungiert ausschließlich der HFSC-Freistadt als Beförderer und ist damit Vertragspartner des oben namentlich angeführten Tandempassagiers. Die Durchführung von Tandemfallschirmsprüngen erfolgt nicht gewerblich, sondern nur im Rahmen der Mitgliederwerbung und zur Popularisierung des Fallschirmsports. Ein allenfalls für die Beförderung vereinbarter Kosten(Mitglieds-)beitrag fließt ungekürzt und unmittelbar dem gemeinnützigen HFSC-Freistadt zu, der damit alleiniger Vertragspartner des Tandempassagiers im Beförderungsvertrag ist. Der jeweilige Tandemmaster bzw. die Person, welche die Vereinbarungen im Zusammenhang mit der Beförderung mit dem Tandempassagier trifft, handelt als Vertreter des HFSC-Freistadt und damit nicht im eigenen Namen.

Zugunsten eines jeden Tandempassagiers (und der mit ihm beförderten Sachen) ist eine gesetzlich vorgeschriebene Haftpflichtversicherung vom Halter der Tandemfallschirme abgeschlossen worden.

Der Tandempassagier verzichtet im Falle eines Schadensereignisses ausdrücklich auf die Geltendmachung von Ansprüchen (z. B. Schadenersatz, Schmerzengeld, Verdienstentgang, Rente etc.) gegenüber dem Tandempiloten und auch gegenüber dem Piloten des Absetzluftfahrzeugs, ausgenommen dem Tandemmaster kann grobe Fahrlässigkeit oder Vorsatz nachgewiesen werden. Die Haftung des Beförderers für die mitbeförderten Sachen des Tandempassagiers beschränkt sich auf die Höhe der dafür abgeschlossenen Versicherung. Darüberhinausgehende Ansprüche können nur bei Vorsatz oder grober Fahrlässigkeit geltend gemacht werden.

Der Tandempassagier ist verpflichtet, den Tandemmaster (im Folgenden kurz TM) darauf hinzuweisen, wenn er:
1) innerhalb der letzten 12 Monate einen schweren Unfall hatte (Knochenbruch, Bänderriss, Gehirnerschütterung oder ähnliches);
2) innerhalb der letzten 12 Monate wegen einer ernsthaften Erkrankung (Herz, Wirbelsäule, Bandscheiben, Bluthochdruck, Organleiden oder ähnlichem) in ärztlicher Behandlung war oder ist;
3) innerhalb der letzten 12 Monate an seelischen oder psychischen Defekten (Drogensucht, Bewusstseinsstörungen oder ähnlichen) gelitten hat oder daran noch leidet;
4) in den letzten 12 Stunden Alkohol zu sich genommen hat.

Der Tandempassagier erklärt hiermit, Nachstehendes zur Kenntnis genommen zu haben und sich entsprechend zu verhalten:

1) Verhalten am Flugplatz:
Immer von hinten zum Flugzeug gehen, nie direkt auf den Propeller zu!
Immer den Anweisungen des TM Folge leisten! Bei Unklarheiten bitte den TM fragen!

2) Einweisung in den Sprungablauf:
Absprung: Hohlkreuz mit Becken nach vorne und somit Körper wie eine Banane halten, Kopf in den Nacken, mit den Händen an den Hosenträger-Gurte greifen und festhalten, nicht am Flugzeug festhalten
Freier Fall: Hohlkreuz, durch die Nase atmen, Mund geschlossen halten, nichts mit den Händen angreifen
Offener Schirm: Anweisungen des TM befolgen, nichts angreifen außer auf ausdrückliche Anweisung des TM
Unmittelbar vor der Landung (Landehaltung): beide Oberschenkel samt Knie 90° anheben, wenn notwendig durch Griff in beide Kniekehlen unterstützen; zusätzlich Unterschenkel mind. 45° nach vorne anheben; Anweisungen des TM befolgen.
Als Passagier bin ich in der Lage, die oben genannte Landehaltung für mindestens eine Minute zu halten.

3) In Notsituationen den Anweisungen des Tandemmaster unbedingt und sofort Folge leisten.
4) Es besteht kein Versicherungsschutz für Brillen, Kontaktlinsen, Schmuck, Uhren und ähnliches bei Beschädigung oder Verlust.
5) Trotz gewissenhafter Sprungvorbereitung bestehen gesundheitliche Risiken auf Grund rascher Druckänderung im Freifall, unplanmäßiger Landung, Störungen am Fallschirm, etc.

Obwohl ein Tandemfallschirmsprung im allgemeinen eine harmlose und ungefährliche Angelegenheit ist, wurde ich dennoch über die eventuellen Unfallgefahren des von mir beabsichtigten Tandemfallschirmsprunges informiert, insbesondere darüber, dass auch bei größter Sorgfalt und optimalen Flugverlauf bei der Öffnung und der Landung durch unplanmäßige Öffnungen, unrichtiges Aufkommen, Auftreten oder Stürze, Unfälle mit nicht unerheblichen Verletzungsfolgen (z. B. Verstauchungen, Knochenbruch, Halswirbelsäulenprellung, Wirbelverletzungen, Gehirnerschütterungen u. v. m.) passieren können. Dieses allgemeine Verletzungsrisiko in der Schirmöffnungs-, Schirmflug und Landephase kann sich durch windbedingten Einfluss, welcher zu einem unruhigen Flugverlauf und dadurch zu einer harten Öffnung und/oder Landung führen kann, erhöhen. Schließlich ist mir bewusst, dass das Extrem-Risiko darin besteht, dass sich der Hauptfallschirm nicht öffnet und der für diesen Fall vorgesehene Reservefallschirm ebenfalls versagt.

Alle Film- und Fotorechte verbleiben beim HFSC-Freistadt. Ich bin damit einverstanden, per E-Mail durch den HFSC-Freistadt zur Übermittlung von Angeboten und Aktionen über das Fallschirmspringen kontaktiert zu werden. Ich bin damit einverstanden, dass meine umseitigen persönlichen Daten automatisationsunterstützt gespeichert und verwaltet werden.

Es ist vereinbart, dass jede Beförderung am Fallschirm und in der Absetzmaschine nach österreichischem Recht erfolgt. Vereinbart wird zudem ausdrücklich der Gerichtsstand Linz.

Ich bestätige, dass ich den obigen Text genau gelesen habe und ich nur dann in das Flugzeug einsteigen werde, wenn ich eine umfassende Einweisung durch den TM erhalten habe und alle mit meinem Tandemfallschirmsprung in Zusammenhang stehenden Fragen zufriedenstellend beantwortet wurden.

Ich bestätige durch den TM eine umfassende Einweisung für den Tandem-Passagier-Fallschirmsprung erhalten zu haben und über das richtige Verhalten informiert worden zu sein. Insbesondere bestätige ich, dass die Absprunghaltung, die Freifallhaltung und die Landehaltung durch den TM vorgezeigt und von mir am Boden nachvollzogen wurden und keine Fragen dazu mehr bestehen.`

export function loadConfig(dir: string): Config {
  const p = path.join(dir, 'config.json')
  const def: Config = { exportDir: dir, contractText: CONTRACT_TEXT, jumpLocation: '' }
  try {
    return { ...def, ...JSON.parse(fs.readFileSync(p, 'utf8')) }
  } catch {
    return def
  }
}

export function saveConfig(dir: string, cfg: Config) {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2))
}
```

- [ ] **Step 2: Update `config.example.json`**

```json
{
  "exportDir": "C:/Users/Manifest/OneDrive/Tandem",
  "contractText": "",
  "jumpLocation": "Freistadt"
}
```

(Left as an example of an *override* file — an empty `contractText` here means "use the shipped default", consistent with how `loadConfig` merges `def` under whatever `config.json` provides.)

- [ ] **Step 3: Commit**

```bash
git add src/server/config.ts config.example.json
git commit -m "Default contractText to the real Befoerderungsvertrag body, add jumpLocation"
```

---

## Task 3: DB schema — `contract_pdf_filename` replaces `signature_png`

**Files:**
- Modify: `src/server/db.ts`
- Modify: `tests/db.test.ts:34-44,115-127`

**Interfaces:**
- Produces: `registrations.contract_pdf_filename TEXT` column; `registrations.signature_png` no longer exists (fresh installs never had it; existing installs get it dropped by `migrate()`).

- [ ] **Step 1: Update the failing expectation first — edit `tests/db.test.ts`**

Replace the `expectedColumns` array (lines 34-44):

```ts
  const expectedColumns = [
    'id', 'first_name', 'last_name', 'gender', 'age',
    'height_cm', 'weight_kg',
    'street', 'postal_code', 'city',
    'email', 'phone', 'contract_pdf_filename',
    'accepted_terms', 'tandem_master_id', 'load_number',
    'price', 'payment_method', 'voucher_number', 'extra_booking',
    'camera_flyer_id', 'created_at', 'jump_date'
  ]
```

And extend the legacy-migration test (lines 115-127) to also assert the column swap:

```ts
test('migrates a legacy database: adds new columns, drops address, drops signature_png', async () => {
  const file = await legacyDbPath()

  const db = openDb(file)
  const names = (db.pragma('table_info(registrations)') as Array<{ name: string }>)
    .map(c => c.name)

  for (const added of ['gender', 'height_cm', 'street', 'postal_code', 'city', 'voucher_number', 'contract_pdf_filename']) {
    expect(names).toContain(added)
  }
  expect(names).not.toContain('address')
  expect(names).not.toContain('signature_png')
  db.close()
})
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `npx vitest run tests/db.test.ts`
Expected: FAIL — `expectedColumns` mismatch (actual still has `signature_png`, missing `contract_pdf_filename`), and the renamed test fails on `not.toContain('signature_png')`.

- [ ] **Step 3: Update `src/server/db.ts`**

```ts
import Database from 'better-sqlite3'

// `nativeBinding` lets us point better-sqlite3 at an explicit better_sqlite3.node
// file instead of letting the `bindings` package search the filesystem. This is
// required in the packaged .exe: pkg cannot serve a native addon out of its
// virtual /snapshot filesystem, so we ship the .node beside the exe and load it
// from that real path. In dev (nativeBinding undefined) the normal resolution runs.
export function openDb(path: string, nativeBinding?: string): Database.Database {
  const db = new Database(path, nativeBinding ? { nativeBinding } : {})
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT, last_name TEXT, gender TEXT, age INTEGER,
      height_cm INTEGER, weight_kg INTEGER,
      street TEXT, postal_code TEXT, city TEXT,
      email TEXT, phone TEXT, contract_pdf_filename TEXT,
      accepted_terms INTEGER,
      tandem_master_id INTEGER, load_number INTEGER, price REAL,
      payment_method TEXT, voucher_number TEXT, extra_booking TEXT,
      camera_flyer_id INTEGER,
      created_at TEXT, jump_date TEXT
    );
    CREATE TABLE IF NOT EXISTS tandem_masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS camera_flyers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  `)
  migrate(db)
  return db
}

// The CREATE TABLE above only ever runs on a fresh file — IF NOT EXISTS makes it
// a no-op against a database that already has the table, so schema changes would
// otherwise never reach an existing tandem.db. Every column added after the
// initial release therefore has to be applied here as well. Both steps are
// idempotent (guarded by the live column list), so this runs on every startup.
function migrate(db: Database.Database): void {
  const columns = () =>
    new Set((db.pragma('table_info(registrations)') as { name: string }[]).map(c => c.name))

  const existing = columns()
  const added: [string, string][] = [
    ['gender', 'TEXT'],
    ['height_cm', 'INTEGER'],
    ['street', 'TEXT'],
    ['postal_code', 'TEXT'],
    ['city', 'TEXT'],
    ['voucher_number', 'TEXT'],
    ['contract_pdf_filename', 'TEXT'],
  ]
  for (const [name, type] of added) {
    if (!existing.has(name)) db.exec(`ALTER TABLE registrations ADD COLUMN ${name} ${type}`)
  }

  // `address` was replaced by street/postal_code/city, and `signature_png` by
  // contract_pdf_filename (a generated PDF replaces the raw signature image).
  // Dropping both gives a migrated database the same column set as a freshly
  // created one.
  if (existing.has('address')) db.exec('ALTER TABLE registrations DROP COLUMN address')
  if (existing.has('signature_png')) db.exec('ALTER TABLE registrations DROP COLUMN signature_png')
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS (all tests, including `a migrated database has the same column set as a fresh one`, which compares sets so column order doesn't matter).

- [ ] **Step 5: Commit**

```bash
git add src/server/db.ts tests/db.test.ts
git commit -m "Replace signature_png column with contract_pdf_filename"
```

---

## Task 4: `contractPdf.ts` — fill the template with guest data + signature

**Files:**
- Create: `src/server/contractPdf.ts`
- Create: `tests/contractPdf.test.ts`

**Interfaces:**
- Produces: `fillContractPdf(templateBytes: Uint8Array, data: ContractPdfData): Promise<Buffer>` and the `ContractPdfData` interface, both exported from `src/server/contractPdf.ts`. This is what Task 6 calls from the registrations route.
- Consumes: `pdf-lib`'s `PDFDocument`, `StandardFonts`, `rgb`.

Coordinates below were measured directly against `assets/Befoerderungsvertrag.pdf` (595 × 842pt, A4) using a throwaway calibration overlay (fine ruler + sample text, rendered and visually checked) — not guessed. Y is PDF-space (origin bottom-left).

- [ ] **Step 1: Write the failing test — create `tests/contractPdf.test.ts`**

```ts
import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { PDFDocument } from 'pdf-lib'
import { fillContractPdf } from '../src/server/contractPdf'

const templateBytes = fs.readFileSync(path.join(__dirname, '..', 'assets', 'Befoerderungsvertrag.pdf'))

// Smallest possible valid PNG (1x1 px), used only so pdf-lib's embedPng has
// real image bytes to decode — the actual look of the signature doesn't matter here.
const SIGNATURE_PNG_1X1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const sampleData = () => ({
  firstName: 'Max', lastName: 'Mustermann',
  street: 'Musterstraße 1', postalCode: '4240', city: 'Freistadt',
  phone: '0660123456', email: 'max@example.at',
  age: 30, heightCm: 182, weightKg: 85,
  ort: 'Freistadt', datum: '16.07.2026',
  signaturePngDataUrl: SIGNATURE_PNG_1X1,
})

test('fillContractPdf returns a real two-page PDF', async () => {
  const buf = await fillContractPdf(templateBytes, sampleData())

  expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-')

  const doc = await PDFDocument.load(buf)
  expect(doc.getPageCount()).toBe(2)
})

test('fillContractPdf output is larger than the bare template (text + image were added)', async () => {
  const buf = await fillContractPdf(templateBytes, sampleData())
  expect(buf.length).toBeGreaterThan(templateBytes.length)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/contractPdf.test.ts`
Expected: FAIL with "Cannot find module '../src/server/contractPdf'" (module doesn't exist yet).

- [ ] **Step 3: Create `src/server/contractPdf.ts`**

```ts
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

export interface ContractPdfData {
  firstName: string
  lastName: string
  street: string
  postalCode: string
  city: string
  phone: string
  email: string
  age: number
  heightCm: number
  weightKg: number
  ort: string
  datum: string
  signaturePngDataUrl: string
}

const FONT_SIZE = 12
const SMALL_FONT_SIZE = 10

// The template's header fields and Ort/Datum/Unterschrift blanks are flat text
// with underlines, not an AcroForm — so filling means drawing text/an image on
// top at fixed coordinates rather than setting named form field values.
// Coordinates measured directly against assets/Befoerderungsvertrag.pdf (595x842pt A4).
const PAGE1 = {
  name: { x: 105, y: 682 },
  street: { x: 195, y: 657 },
  plzCity: { x: 165, y: 632 },
  phone: { x: 95, y: 608, size: SMALL_FONT_SIZE },
  email: { x: 290, y: 608, size: SMALL_FONT_SIZE },
  age: { x: 100, y: 580 },
  height: { x: 210, y: 580 },
  weight: { x: 350, y: 580 },
}

const PAGE2 = {
  ort: { x: 85, y: 82 },
  datum: { x: 245, y: 82, size: SMALL_FONT_SIZE },
  signature: { x: 440, y: 84, width: 90, height: 36 },
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return new Uint8Array(Buffer.from(base64, 'base64'))
}

export async function fillContractPdf(
  templateBytes: Uint8Array,
  data: ContractPdfData
): Promise<Buffer> {
  const doc = await PDFDocument.load(templateBytes)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const [page1, page2] = doc.getPages()
  const black = rgb(0, 0, 0)

  const draw = (
    page: typeof page1,
    text: string,
    spec: { x: number; y: number; size?: number }
  ) => page.drawText(text, { x: spec.x, y: spec.y, size: spec.size ?? FONT_SIZE, font, color: black })

  draw(page1, `${data.firstName} ${data.lastName}`, PAGE1.name)
  draw(page1, data.street, PAGE1.street)
  draw(page1, `${data.postalCode} ${data.city}`, PAGE1.plzCity)
  draw(page1, data.phone, PAGE1.phone)
  draw(page1, data.email, PAGE1.email)
  draw(page1, String(data.age), PAGE1.age)
  draw(page1, String(data.heightCm), PAGE1.height)
  draw(page1, String(data.weightKg), PAGE1.weight)

  draw(page2, data.ort, PAGE2.ort)
  draw(page2, data.datum, PAGE2.datum)

  const signatureImage = await doc.embedPng(dataUrlToBytes(data.signaturePngDataUrl))
  page2.drawImage(signatureImage, {
    x: PAGE2.signature.x,
    y: PAGE2.signature.y,
    width: PAGE2.signature.width,
    height: PAGE2.signature.height,
  })

  const bytes = await doc.save()
  return Buffer.from(bytes)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/contractPdf.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/contractPdf.ts tests/contractPdf.test.ts
git commit -m "Add contractPdf.ts to fill the template PDF with guest data and signature"
```

---

## Task 5: Shared test server helper

**Files:**
- Create: `tests/helpers/testServer.ts`

**Interfaces:**
- Produces: `testServer(cfgOverrides?: Partial<Config>): { app: FastifyInstance; cfgRef: { current: Config } }`, used by Task 6's updates to `tests/health.test.ts`, `tests/settings.test.ts`, `tests/stammdaten.test.ts`, `tests/registrations.test.ts`, `tests/manifest-update.test.ts`.
- Consumes: `openDb` from `../../src/server/db`, `buildServer` from `../../src/server/index` (its new signature from Task 6), `Config` from `../../src/server/config`.

This task exists because Task 6 changes `buildServer`'s signature (adds a required `contractTemplate` parameter), and five existing test files each call `buildServer(openDb(':memory:'), { current: {...} })` directly, many times per file. Centralizing that call avoids repeating the template-loading boilerplate at every one of those ~25 call sites.

- [ ] **Step 1: Create `tests/helpers/testServer.ts`**

```ts
import fs from 'fs'
import path from 'path'
import os from 'os'
import { openDb } from '../../src/server/db'
import { buildServer } from '../../src/server/index'
import type { Config } from '../../src/server/config'

const templateBytes = fs.readFileSync(
  path.join(__dirname, '..', '..', 'assets', 'Befoerderungsvertrag.pdf')
)

export function testServer(cfgOverrides: Partial<Config> = {}) {
  const cfgRef = {
    current: {
      exportDir: os.tmpdir(),
      contractText: '',
      jumpLocation: '',
      ...cfgOverrides,
    },
  }
  return { app: buildServer(openDb(':memory:'), cfgRef, templateBytes), cfgRef }
}
```

- [ ] **Step 2: Commit**

This has no independent test of its own (it's a test helper, exercised transitively by Task 6). Commit it together with Task 6's changes — do not commit it alone, since `buildServer`'s old 2-arg signature still matches at this point and nothing calls this helper yet.

---

## Task 6: Registration route generates the PDF; wire `buildServer`/`main.ts`; migrate existing tests

**Files:**
- Modify: `src/server/routes/registrations.ts`
- Modify: `src/server/index.ts`
- Modify: `src/server/main.ts`
- Modify: `tests/health.test.ts`
- Modify: `tests/settings.test.ts`
- Modify: `tests/stammdaten.test.ts`
- Modify: `tests/registrations.test.ts`
- Modify: `tests/manifest-update.test.ts`

**Interfaces:**
- Consumes: `fillContractPdf`/`ContractPdfData` from `../contractPdf` (Task 4); `testServer` from `tests/helpers/testServer` (Task 5).
- Produces: `registerRegistrationRoutes(app, db, sse, cfgRef, contractTemplate: Buffer)` (signature changed — was `(app, db, sse)`); `buildServer(db, cfgRef, contractTemplate: Buffer, persist?)` (signature changed — was `(db, cfgRef, persist?)`); new route `GET /api/registrations/:id/contract.pdf`.

- [ ] **Step 1: Rewrite `src/server/routes/registrations.ts`**

```ts
import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import { validateGuest } from '../validation'
import { SseHub } from '../sse'
import { fillContractPdf } from '../contractPdf'
import type { Config } from '../config'

const today = () => new Date().toISOString().slice(0, 10)

function safeNamePart(s: string): string {
  return s.trim().replace(/[\\/:*?"<>|]/g, '')
}

async function uniqueContractFilename(dir: string, base: string): Promise<string> {
  let candidate = `${base}.pdf`
  let n = 2
  while (true) {
    try {
      await fs.access(path.join(dir, candidate))
      candidate = `${base} (${n}).pdf`
      n += 1
    } catch {
      return candidate
    }
  }
}

export function registerRegistrationRoutes(
  app: FastifyInstance,
  db: Database,
  sse: SseHub,
  cfgRef: { current: Config },
  contractTemplate: Buffer
) {
  app.post('/api/registrations', async (req, reply) => {
    const r = validateGuest(req.body)
    if (!r.ok) return reply.code(400).send({ errors: r.errors })
    const v = r.value
    const jumpDate = today()

    const vertraegeDir = path.join(cfgRef.current.exportDir, 'vertaege')
    await fs.mkdir(vertraegeDir, { recursive: true })
    const dateStamp = jumpDate.replaceAll('-', '.')
    const base = `${dateStamp}_${safeNamePart(v.last_name)}-${safeNamePart(v.first_name)}`
    const filename = await uniqueContractFilename(vertraegeDir, base)

    const pdf = await fillContractPdf(contractTemplate, {
      firstName: v.first_name, lastName: v.last_name,
      street: v.street, postalCode: v.postal_code, city: v.city,
      phone: v.phone, email: v.email,
      age: v.age, heightCm: v.height_cm, weightKg: v.weight_kg,
      ort: cfgRef.current.jumpLocation,
      datum: jumpDate.split('-').reverse().join('.'),
      signaturePngDataUrl: v.signature_png,
    })
    await fs.writeFile(path.join(vertraegeDir, filename), pdf)

    const info = db.prepare(`INSERT INTO registrations
      (first_name,last_name,gender,age,height_cm,weight_kg,
       street,postal_code,city,email,phone,contract_pdf_filename,
       accepted_terms,created_at,jump_date)
      VALUES (@first_name,@last_name,@gender,@age,@height_cm,@weight_kg,
       @street,@postal_code,@city,@email,@phone,
       @contract_pdf_filename,1,@created_at,@jump_date)`)
      .run({ ...v, contract_pdf_filename: filename, created_at: new Date().toISOString(), jump_date: jumpDate })
    sse.broadcast('changed', { id: info.lastInsertRowid })
    return reply.code(201).send({ id: info.lastInsertRowid })
  })

  app.get('/api/registrations', async (req) => {
    const date = (req.query as any)?.date || today()
    return db.prepare('SELECT * FROM registrations WHERE jump_date = ? ORDER BY id')
      .all(date)
  })

  app.get('/api/registrations/:id/contract.pdf', async (req, reply) => {
    const id = (req.params as any).id
    const row = db.prepare('SELECT contract_pdf_filename FROM registrations WHERE id=?').get(id) as
      { contract_pdf_filename: string | null } | undefined
    if (!row?.contract_pdf_filename) return reply.code(404).send()
    const filePath = path.join(cfgRef.current.exportDir, 'vertaege', row.contract_pdf_filename)
    try {
      const bytes = await fs.readFile(filePath)
      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', 'inline')
      return reply.send(bytes)
    } catch {
      return reply.code(404).send()
    }
  })

  app.get('/api/events', (req, reply) => sse.handler(req, reply))

  const ALLOWED = ['tandem_master_id', 'load_number', 'price', 'payment_method',
    'voucher_number', 'extra_booking', 'camera_flyer_id'] as const
  const PAY = ['voucher', 'cash', 'card']
  const EXTRA = ['none', 'video', 'video_photo']

  app.patch('/api/registrations/:id', async (req, reply) => {
    const id = (req.params as any).id
    const body = (req.body as any) ?? {}
    const keys = ALLOWED.filter(k => k in body)
    if ('payment_method' in body && !PAY.includes(body.payment_method))
      return reply.code(400).send({ error: 'Zahlungsart ungültig' })
    if ('extra_booking' in body && !EXTRA.includes(body.extra_booking))
      return reply.code(400).send({ error: 'Zusatzbuchung ungültig' })
    if (keys.length) {
      const set = keys.map(k => `${k}=@${k}`).join(', ')
      const result = db.prepare(`UPDATE registrations SET ${set} WHERE id=@id`).run({ ...body, id })
      if (result.changes === 0) return reply.code(404).send()
      sse.broadcast('changed', { id })
      return db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    }
    const row = db.prepare('SELECT * FROM registrations WHERE id=?').get(id)
    if (!row) return reply.code(404).send()
    return row
  })
}
```

- [ ] **Step 2: Update `src/server/index.ts`**

```ts
import Fastify, { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { SseHub } from './sse'
import { registerRegistrationRoutes } from './routes/registrations'
import { registerStammdatenRoutes } from './routes/stammdaten'
import { registerExportRoutes } from './routes/export'
import { registerSettingsRoutes } from './routes/settings'
import type { Config } from './config'

export function buildServer(
  db: Database,
  cfgRef: { current: Config },
  contractTemplate: Buffer,
  persist?: (c: Config) => void
): FastifyInstance {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 }) // signatures
  const sse = new SseHub()
  app.get('/api/health', async () => ({ ok: true }))
  registerRegistrationRoutes(app, db, sse, cfgRef, contractTemplate)
  registerStammdatenRoutes(app, db)
  registerExportRoutes(app, db, () => cfgRef.current.exportDir)
  registerSettingsRoutes(app, cfgRef, persist)
  return app
}
```

- [ ] **Step 3: Update `src/server/main.ts`**

Add the template load right after the `nativeBinding` existence check (before `const db = openDb(...)`, around line 37):

```ts
const templatePath = isPackaged
  ? path.join(__dirname, '..', 'assets', 'Befoerderungsvertrag.pdf')
  : path.join(installDir, 'assets', 'Befoerderungsvertrag.pdf')
const contractTemplate = fs.readFileSync(templatePath)

const db = openDb(path.join(dir, 'tandem.db'), nativeBinding)
const cfgRef = { current: loadConfig(dir) }
const app = buildServer(db, cfgRef, contractTemplate, (c) => saveConfig(dir, c))
```

(This replaces the existing two lines `const db = openDb(...)` / `const cfgRef = ...` / `const app = buildServer(db, cfgRef, (c) => saveConfig(dir, c))` — same variables, just inserting `contractTemplate` before them and passing it as the 3rd argument to `buildServer`.)

- [ ] **Step 4: Replace `tests/health.test.ts`**

```ts
import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

test('health returns ok', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  expect(res.json()).toEqual({ ok: true })
  await app.close()
})
```

- [ ] **Step 5: Replace `tests/settings.test.ts`**

```ts
import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

test('get/put settings', async () => {
  const { app, cfgRef } = testServer({ exportDir: '/tmp/x' })
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '/tmp/y', contractText: 'Hallo' } })
  const res = await app.inject({ method: 'GET', url: '/api/settings' })
  expect(res.json().contractText).toBe('Hallo')
  expect(cfgRef.current.exportDir).toBe('/tmp/y')
  await app.close()
})

test('put settings rejects empty exportDir', async () => {
  const { app, cfgRef } = testServer({ exportDir: '/tmp/x' })
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '' } })
  expect(res.statusCode).toBe(400)
  expect(res.json().error).toBe('exportDir ungültig')
  expect(cfgRef.current.exportDir).toBe('/tmp/x')
  await app.close()
})

test('put settings accepts valid exportDir', async () => {
  const { app, cfgRef } = testServer({ exportDir: '/tmp/x' })
  const res = await app.inject({ method: 'PUT', url: '/api/settings', payload: { exportDir: '/tmp/z' } })
  expect(res.statusCode).toBe(200)
  expect(cfgRef.current.exportDir).toBe('/tmp/z')
  await app.close()
})
```

- [ ] **Step 6: Replace `tests/stammdaten.test.ts`**

```ts
import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

test('add and list tandem masters', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/masters', payload: { name: 'Hans' } })
  const list = await app.inject({ method: 'GET', url: '/api/masters' })
  expect(list.json()[0].name).toBe('Hans')
  await app.close()
})

test('unknown kind returns 404', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/bogus' })
  expect(res.statusCode).toBe(404)
  await app.close()
})

test('empty name returns 400', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/masters', payload: { name: '' } })
  expect(res.statusCode).toBe(400)
  await app.close()
})

test('delete soft-deletes and excludes from list', async () => {
  const { app } = testServer()
  const created = await app.inject({ method: 'POST', url: '/api/flyers', payload: { name: 'Peter' } })
  const { id } = created.json()
  const del = await app.inject({ method: 'DELETE', url: `/api/flyers/${id}` })
  expect(del.statusCode).toBe(204)
  const list = await app.inject({ method: 'GET', url: '/api/flyers' })
  expect(list.json()).toEqual([])
  await app.close()
})
```

- [ ] **Step 7: Update `tests/registrations.test.ts`**

Replace the top of the file (imports and the `validBody` — drop the `os` import, it's no longer used directly):

```ts
import { test, expect } from 'vitest'
import { testServer } from './helpers/testServer'

const validBody = () => ({
  first_name: 'A', last_name: 'B', gender: 'female', age: 30,
  height_cm: 170, weight_kg: 80,
  street: 'X 1', postal_code: '4240', city: 'Freistadt',
  email: 'a@b.de', phone: '0660',
  signature_png: 'data:image/png;base64,x', accepted_terms: true
})
```

Then, in every one of the 6 test bodies below, replace the line
`const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })`
with:
`const { app } = testServer()`

This is a mechanical 1-for-1 replacement — the rest of every test body (assertions, `app.inject` calls, `app.close()`) is unchanged. There are 6 occurrences: `create then list returns the record`, `rejects a registration with an unknown gender`, `rejects invalid`, `filters registrations by jump_date`, `broadcasts a "changed" SSE event when a registration is created` (this one also has a `app.listen(...)` line right after — leave that line as-is, only the `const app = buildServer(...)` line changes).

Note: `signature_png: 'data:image/png;base64,x'` in `validBody()` stays exactly as-is — it's still the wire input `validateGuest` requires and `contractPdf.ts` embeds as the signature image. Since it's a 1x1-ish tiny non-PNG string here (`base64,x` isn't valid PNG bytes), **and these tests now go through real PDF generation via `fillContractPdf`, which calls `pdf-lib`'s `embedPng` on it** — that will throw on invalid PNG bytes. Fix this in the same step by changing every `signature_png: 'data:image/png;base64,x'` to a real tiny valid PNG:

```ts
signature_png: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
```

- [ ] **Step 8: Update `tests/manifest-update.test.ts`**

Same mechanical change as Step 7: replace the imports (drop `openDb`/`buildServer`/`os`, add `import { testServer } from './helpers/testServer'`), replace `validBody()`'s `signature_png` value with the same real tiny PNG data URL as Step 7, and replace every occurrence of
`const app = buildServer(openDb(':memory:'), { current: { exportDir: os.tmpdir(), contractText: '' } })`
with
`const { app } = testServer()`.//
There are 11 occurrences across this file's tests (`patch adds manifest fields`, `patch stores a voucher number...`, `patch clears the voucher number...`, `patch updates only the provided keys`, `rejects invalid payment_method...`, `rejects invalid extra_booking...`, `returns 404 for unknown id`, `rejects empty-string payment_method...`, `rejects null payment_method...`, `rejects empty-string extra_booking...`, `does not broadcast "changed"...` — this last one has no `POST /api/registrations` call so it isn't affected by the PNG change but still needs the `testServer()` swap — and `ignores keys not in the allowlist...`, `broadcasts a "changed" SSE event on patch`). All test bodies are otherwise unchanged.

- [ ] **Step 9: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — all suites green, including the new `contractPdf.test.ts` and the migrated files. If `manifest-update.test.ts` or `registrations.test.ts` still fail with a PNG decode error, grep the file for `base64,x` to find a remaining unfixed `signature_png` literal.

- [ ] **Step 10: Commit**

```bash
git add src/server/routes/registrations.ts src/server/index.ts src/server/main.ts \
  tests/helpers/testServer.ts tests/health.test.ts tests/settings.test.ts \
  tests/stammdaten.test.ts tests/registrations.test.ts tests/manifest-update.test.ts
git commit -m "Generate and store a filled contract PDF per registration instead of a raw signature PNG"
```

---

## Task 7: Manifest — Settings UI for `jumpLocation`, API types

**Files:**
- Modify: `web/manifest/src/Settings.tsx`
- Modify: `web/manifest/src/api.ts`

**Interfaces:**
- Produces: `Settings.jumpLocation: string` field in the manifest Settings screen; `Registration.contract_pdf_filename: string | null` (replaces `signature_png`); `contractPdfUrl(id: number): string` helper.
- Consumes: existing `getSettings`/`putSettings` (unchanged signatures, `PUT /api/settings` already merges arbitrary keys server-side).

- [ ] **Step 1: Update `web/manifest/src/api.ts`**

In the `Registration` interface (around line 36-60), replace:

```ts
  signature_png: string
```

with:

```ts
  contract_pdf_filename: string | null
```

In the `Settings` interface (around line 67-70), add the new field:

```ts
export interface Settings {
  exportDir: string
  contractText: string
  jumpLocation: string
}
```

Add a new exported helper right after `putSettings` (around line 161):

```ts
export function contractPdfUrl(id: number): string {
  return apiUrl(`/api/registrations/${id}/contract.pdf`)
}
```

- [ ] **Step 2: Replace `web/manifest/src/Settings.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { getSettings, putSettings } from './api'

export default function Settings() {
  const [exportDir, setExportDir] = useState('')
  const [jumpLocation, setJumpLocation] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getSettings()
      .then((cfg) => {
        setExportDir(cfg.exportDir)
        setJumpLocation(cfg.jumpLocation)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const cfg = await putSettings({ exportDir, jumpLocation })
      setExportDir(cfg.exportDir)
      setJumpLocation(cfg.jumpLocation)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p>Lädt…</p>

  return (
    <div className="settings-screen">
      <h2>Einstellungen</h2>
      <label className="field">
        Export-Verzeichnis
        <input
          type="text"
          value={exportDir}
          onChange={(e) => {
            setExportDir(e.target.value)
            setSaved(false)
          }}
        />
      </label>

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

      {error && <p className="error">{error}</p>}
      {saved && !error && <p className="hint">Gespeichert.</p>}

      <div className="actions">
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run manifest type check**

Run: `npm --prefix web/manifest run build`
Expected: Fails at this point — `Detail.tsx`, `Print.tsx`, `List.test.tsx`, `Print.test.tsx` still reference `signature_png`. That's expected; Task 8 fixes them. Confirm the failure is *only* in those files (not in `Settings.tsx`/`api.ts`), then proceed.

- [ ] **Step 4: Commit**

```bash
git add web/manifest/src/api.ts web/manifest/src/Settings.tsx
git commit -m "Add jumpLocation setting and contract_pdf_filename to the manifest API types"
```

---

## Task 8: Manifest — retire the print overlay, open the real signed PDF instead

**Files:**
- Delete: `web/manifest/src/Print.tsx`
- Delete: `web/manifest/src/Print.test.tsx`
- Delete: `web/manifest/src/print.css`
- Modify: `web/manifest/src/main.tsx`
- Modify: `web/manifest/src/App.tsx`
- Modify: `web/manifest/src/Detail.tsx`
- Modify: `web/manifest/src/List.test.tsx`

**Interfaces:**
- Consumes: `contractPdfUrl` from `./api` (Task 7).

- [ ] **Step 1: Delete the print-overlay files**

```bash
git rm web/manifest/src/Print.tsx web/manifest/src/Print.test.tsx web/manifest/src/print.css
```

- [ ] **Step 2: Update `web/manifest/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

(Only the `import './print.css'` line is removed.)

- [ ] **Step 3: Update `web/manifest/src/App.tsx`**

```tsx
import { useState } from 'react'
import List from './List'
import Detail from './Detail'
import Stammdaten from './Stammdaten'
import Settings from './Settings'
import type { Registration } from './api'

type View = 'list' | 'detail' | 'stammdaten' | 'settings'

function App() {
  const [view, setView] = useState<View>('list')
  const [selected, setSelected] = useState<Registration | null>(null)

  function openDetail(registration: Registration) {
    setSelected(registration)
    setView('detail')
  }

  function closeDetail() {
    setSelected(null)
    setView('list')
  }

  return (
    <div className="app-root">
      <nav className="tabs">
        <button
          type="button"
          className={view === 'list' || view === 'detail' ? 'tab active' : 'tab'}
          onClick={() => setView('list')}
        >
          Manifest
        </button>
        <button
          type="button"
          className={view === 'stammdaten' ? 'tab active' : 'tab'}
          onClick={() => setView('stammdaten')}
        >
          Stammdaten
        </button>
        <button
          type="button"
          className={view === 'settings' ? 'tab active' : 'tab'}
          onClick={() => setView('settings')}
        >
          Einstellungen
        </button>
      </nav>

      <main className="view">
        {view === 'list' && <List onSelect={openDetail} />}
        {view === 'detail' && selected && (
          <Detail registration={selected} onBack={closeDetail} onSaved={setSelected} />
        )}
        {view === 'stammdaten' && <Stammdaten />}
        {view === 'settings' && <Settings />}
      </main>
    </div>
  )
}

export default App
```

- [ ] **Step 4: Update `web/manifest/src/Detail.tsx`**

Change the import line (line 2):

```ts
import { patch, flyers as fetchFlyers, masters as fetchMasters, contractPdfUrl } from './api'
```

Replace the actions block (lines 208-221):

```tsx
      <div className="actions">
        <a
          className="btn secondary"
          href={contractPdfUrl(registration.id)}
          target="_blank"
          rel="noreferrer"
        >
          Vertrag öffnen
        </a>
        <button type="button" className="btn primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Speichert…' : 'Speichern'}
        </button>
      </div>
```

(This also removes the comment block above the old button that referenced `Print.tsx`/`print.css`, since both are deleted.)

- [ ] **Step 5: Update `web/manifest/src/List.test.tsx`**

In `makeRow` (around line 15-42), replace:

```ts
    signature_png: '',
```

with:

```ts
    contract_pdf_filename: null,
```

- [ ] **Step 6: Run the manifest test suite and type check**

Run: `npm --prefix web/manifest run test`
Expected: PASS.

Run: `npm --prefix web/manifest run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add web/manifest/src/main.tsx web/manifest/src/App.tsx web/manifest/src/Detail.tsx \
  web/manifest/src/List.test.tsx
git rm web/manifest/src/Print.tsx web/manifest/src/Print.test.tsx web/manifest/src/print.css
git commit -m "Replace the manifest print overlay with a link to the real signed contract PDF"
```

---

## Task 9: Guest app — merge signing into the contract screen, reorder Form before Contract

**Files:**
- Modify: `web/guest/src/Contract.tsx`
- Delete: `web/guest/src/Sign.tsx`
- Delete: `web/guest/src/Sign.test.tsx`
- Create: `web/guest/src/Contract.test.tsx`
- Modify: `web/guest/src/App.tsx`

**Interfaces:**
- Produces: `Contract` component now takes `{ onNext: (signaturePng: string) => void; onCancel?: () => void; submitting?: boolean; errors?: string[] | null }` (was `{ onNext: () => void; onCancel?: () => void }`).
- Consumes: `getContract` from `./api` (unchanged).

- [ ] **Step 1: Replace `web/guest/src/Contract.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { getContract } from './api'

export interface ContractProps {
  onNext: (signaturePng: string) => void
  onCancel?: () => void
  submitting?: boolean
  errors?: string[] | null
}

const CANVAS_WIDTH = 700
const CANVAS_HEIGHT = 280

export default function Contract({ onNext, onCancel, submitting, errors }: ContractProps) {
  const [text, setText] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    let cancelled = false
    getContract()
      .then((t) => {
        if (!cancelled) setText(t)
      })
      .catch(() => {
        if (!cancelled) setLoadError('Vertragstext konnte nicht geladen werden.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function getContext(): CanvasRenderingContext2D | null {
    return canvasRef.current?.getContext('2d') ?? null
  }

  function point(e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = getContext()
    if (!ctx) return
    drawingRef.current = true
    const { x, y } = point(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = getContext()
    if (!ctx) return
    const { x, y } = point(e)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#111'
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasDrawn(true)
  }

  function stopDrawing() {
    drawingRef.current = false
  }

  // Paint the white background exactly once, on mount — see Sign.tsx's original
  // note (now merged here): this must NOT depend on `hasDrawn`, or the re-render
  // it causes on the first pointermove would wipe the stroke just drawn.
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d') ?? null
    if (!canvas || !ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }, [])

  function handleClear() {
    const canvas = canvasRef.current
    const ctx = getContext()
    if (!canvas || !ctx) return
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  function handleNext() {
    const canvas = canvasRef.current
    if (!canvas || !hasDrawn) return
    onNext(canvas.toDataURL('image/png'))
  }

  return (
    <section className="screen contract-screen">
      <h1>Teilnahmebedingungen</h1>
      <div className="contract-text" role="region" aria-label="Teilnahmebedingungen">
        {loading && <p>Lade Vertragstext…</p>}
        {!loading && loadError && <p className="error">{loadError}</p>}
        {!loading && !loadError && text.trim().length === 0 && (
          <p>Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.</p>
        )}
        {!loading && !loadError && text.trim().length > 0 && (
          <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
        )}
      </div>

      <h2>Unterschrift</h2>
      <p>Mit deiner Unterschrift bestätigst du, den Vertrag gelesen und akzeptiert zu haben.</p>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="signature-pad"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
        onPointerCancel={stopDrawing}
      />

      {errors && errors.length > 0 && (
        <ul className="error">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      <div className="actions">
        {onCancel && (
          <button type="button" className="btn secondary" onClick={onCancel} disabled={submitting}>
            Abbrechen
          </button>
        )}
        <button type="button" className="btn secondary" onClick={handleClear} disabled={submitting}>
          Löschen
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!hasDrawn || submitting}
          onClick={handleNext}
        >
          {submitting ? 'Wird gesendet…' : 'Weiter'}
        </button>
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Delete the standalone Sign screen and its test**

```bash
git rm web/guest/src/Sign.tsx web/guest/src/Sign.test.tsx
```

- [ ] **Step 3: Create `web/guest/src/Contract.test.tsx`**

```tsx
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Contract from './Contract'
import * as api from './api'

// jsdom does not implement a real canvas 2D rendering context, so we install a
// minimal fake one (call tracking only) — see the original note this replaces
// in the now-deleted Sign.test.tsx.
function installFakeCanvasContext() {
  const fillRect = vi.fn()
  const stroke = vi.fn()
  const beginPath = vi.fn()
  const moveTo = vi.fn()
  const lineTo = vi.fn()

  const fakeContext = {
    fillRect,
    stroke,
    beginPath,
    moveTo,
    lineTo,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: 'butt' as CanvasLineCap,
  } as unknown as CanvasRenderingContext2D

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA')
  HTMLCanvasElement.prototype.setPointerCapture = vi.fn()
}

describe('Contract', () => {
  beforeEach(() => {
    installFakeCanvasContext()
    vi.spyOn(api, 'getContract').mockResolvedValue('Vertragstext hier.')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the contract text and enables "Weiter" only after a signature is drawn', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)

    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeDisabled()

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 15, clientY: 12, pointerId: 1 })

    expect(submit).toBeEnabled()

    fireEvent.click(submit)

    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).toBe('data:image/png;base64,AAAA')
  })

  it('"Löschen" repaints the background and disables "Weiter" again', async () => {
    const onNext = vi.fn()
    render(<Contract onNext={onNext} />)
    await waitFor(() => screen.getByText('Vertragstext hier.'))

    const canvas = document.querySelector('canvas.signature-pad') as HTMLCanvasElement
    const submit = screen.getByRole('button', { name: 'Weiter' })
    const clear = screen.getByRole('button', { name: 'Löschen' })

    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 15, clientY: 12, pointerId: 1 })
    expect(submit).toBeEnabled()

    fireEvent.click(clear)

    expect(submit).toBeDisabled()
    expect(onNext).not.toHaveBeenCalled()
  })

  it('shows a message when there is no contract text configured', async () => {
    vi.spyOn(api, 'getContract').mockResolvedValue('')
    render(<Contract onNext={vi.fn()} />)

    await waitFor(() =>
      screen.getByText('Es liegt derzeit kein Vertragstext vor. Bitte wende dich an das Personal.')
    )
  })
})
```

- [ ] **Step 4: Replace `web/guest/src/App.tsx`**

```tsx
import { useState } from 'react'
import Welcome from './Welcome'
import Form from './Form'
import type { FormValues } from './Form'
import Contract from './Contract'
import Done from './Done'
import HiddenSettings from './HiddenSettings'
import { submitRegistration } from './api'

type Screen = 'welcome' | 'form' | 'contract' | 'done'

function App() {
  const [screen, setScreen] = useState<Screen>('welcome')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [formValues, setFormValues] = useState<FormValues | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitErrors, setSubmitErrors] = useState<string[] | null>(null)

  function resetToWelcome() {
    setScreen('welcome')
    setFormValues(null)
    setSubmitErrors(null)
    setSubmitting(false)
  }

  async function handleSign(signaturePng: string) {
    if (!formValues) return
    setSubmitting(true)
    setSubmitErrors(null)
    const result = await submitRegistration({
      ...formValues,
      signature_png: signaturePng,
      accepted_terms: true,
    })
    setSubmitting(false)
    if (result.ok) {
      setScreen('done')
    } else {
      setSubmitErrors(result.errors)
    }
  }

  return (
    <div className="app-root">
      {screen === 'welcome' && (
        <Welcome
          onStart={() => setScreen('form')}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}
      {screen === 'form' && (
        <Form
          onNext={(values) => {
            setFormValues(values)
            setScreen('contract')
          }}
          onCancel={resetToWelcome}
        />
      )}
      {screen === 'contract' && (
        <Contract
          onNext={handleSign}
          onCancel={resetToWelcome}
          submitting={submitting}
          errors={submitErrors}
        />
      )}
      {screen === 'done' && <Done onTimeout={resetToWelcome} />}

      {settingsOpen && <HiddenSettings onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

export default App
```

- [ ] **Step 5: Run the guest test suite and type check**

Run: `npm --prefix web/guest run test`
Expected: PASS (Contract.test.tsx's 3 tests; no more Sign.test.tsx).

Run: `npm --prefix web/guest run build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add web/guest/src/Contract.tsx web/guest/src/Contract.test.tsx web/guest/src/App.tsx
git rm web/guest/src/Sign.tsx web/guest/src/Sign.test.tsx
git commit -m "Merge signing into the contract screen; guest now signs the contract directly"
```

---

## Task 10: End-to-end test — new step order

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: the reordered guest flow from Task 9 (`welcome → form → contract(+sign) → done`).

- [ ] **Step 1: Update the guest kiosk section of `tests/e2e/flow.spec.ts`**

Replace lines 23-76 (from the `--- Guest kiosk` comment through the "Vielen Dank!" assertion):

```ts
  // --- Guest kiosk: welcome -> form -> contract (+ signature) -> done ---
  // Trailing slash required: @fastify/static serves the SPA's index.html at
  // the prefix root ('/guest/') but does not redirect the bare prefix
  // ('/guest') to it, so the bare path 404s.
  await page.goto('/guest/')

  await page.getByRole('button', { name: 'Anmeldung starten' }).click()

  await page.getByLabel('Vorname').fill(GUEST.firstName)
  await page.getByLabel('Nachname').fill(GUEST.lastName)
  await page.getByRole('radio', { name: GUEST.gender }).check()
  await page.getByLabel('Alter').fill(GUEST.age)
  await page.getByLabel('Größe (cm)').fill(GUEST.height)
  await page.getByLabel('Gewicht (kg)').fill(GUEST.weight)
  await page.getByLabel('Straße und Hausnummer').fill(GUEST.street)
  await page.getByLabel('PLZ').fill(GUEST.postalCode)
  await page.getByLabel('Wohnort').fill(GUEST.city)
  await page.getByLabel('E-Mail').fill(GUEST.email)
  await page.getByLabel('Telefon').fill(GUEST.phone)

  const formWeiter = page.getByRole('button', { name: 'Weiter' })
  await expect(formWeiter).toBeEnabled()
  await formWeiter.click()

  await expect(page.getByRole('heading', { name: 'Teilnahmebedingungen' })).toBeVisible()

  // Draw a real multi-segment signature stroke on the canvas so `hasDrawn`
  // flips true and the PNG isn't blank. Signing this screen submits directly —
  // there is no separate checkbox or later sign screen anymore.
  const canvas = page.locator('canvas.signature-pad')
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  if (!box) throw new Error('signature canvas has no bounding box')
  await page.mouse.move(box.x + 20, box.y + 20)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 60)
  await page.mouse.move(box.x + 150, box.y + 30)
  await page.mouse.move(box.x + 220, box.y + 90)
  await page.mouse.up()

  const signWeiter = page.getByRole('button', { name: 'Weiter' })
  await expect(signWeiter).toBeEnabled()

  const [submitResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/registrations') && r.request().method() === 'POST'
    ),
    signWeiter.click(),
  ])
  expect(submitResponse.status()).toBe(201)

  await expect(page.getByRole('heading', { name: 'Vielen Dank!' })).toBeVisible()
```

Everything from `// --- Manifest PC: list shows the new row ---` onward (the rest of the file) is unchanged.

- [ ] **Step 2: Run the e2e suite**

Run: `npx playwright test`
Expected: PASS. (This requires `npm run build:web` to have been run first if the config serves the built `dist` output — check `playwright.config.ts`/`tests/e2e/env.ts` for how the server under test is started; use whatever command that config already documents.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/flow.spec.ts
git commit -m "Update e2e test for the merged contract+sign guest flow"
```

---

## Task 11: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit/integration suite**

The root `vitest.config.ts` excludes `web/**` on purpose (guest/manifest each have their own jsdom-based config) — so this is three separate commands, not one:

Run: `npx vitest run` (server tests, `tests/*.test.ts`)
Run: `npm --prefix web/guest run test`
Run: `npm --prefix web/manifest run test`
Expected: all three pass.

- [ ] **Step 2: Type-check everything**

Run: `npx tsc --noEmit` (root), `npm --prefix web/guest run build`, `npm --prefix web/manifest run build`
Expected: no errors.

- [ ] **Step 3: Run the e2e suite once more end-to-end**

Run: `npx playwright test`
Expected: PASS.

- [ ] **Step 4: Manual smoke check**

Run: `npm start`, open `http://localhost/guest` (or whatever `PORT` is set), go through Welcome → Form → Contract (verify the real vertragstext renders, sign, submit), then open `http://localhost/manifest`, select the new row, click "Vertrag öffnen", and confirm the opened PDF shows the guest's name/address/phone/email/age/height/weight and the signature image in roughly the right places on page 1/2, with Tandemmaster and Gutschein-Nr. blank and Ort/Datum filled.
