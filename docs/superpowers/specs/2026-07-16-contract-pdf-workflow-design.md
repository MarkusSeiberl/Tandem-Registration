# Contract PDF workflow — design

Date: 2026-07-16

## Goal

`Befoerderungsvertrag.pdf` is the club's real paper contract (header form fields,
contract body, signature block). Today the app has none of this: `contractText`
defaults to an empty string, and the guest signs a plain canvas whose PNG is
stored as a base64 string in the `registrations.signature_png` column, two
screens after reading the contract. This change:

1. Populates the app's contract text from the real document.
2. Moves signing to happen together with reading the contract, not afterward.
3. Replaces the stored PNG with an actual filled-in, signed copy of the PDF.

## 1. Vertragstext extraction

The PDF has three regions:

- **Page 1 header** (Gutschein Nr., Tandemmaster, Herr/Frau, Straße,
  PLZ/Wohnort, Telefon, E-Mail, Alter/Größe/Gewicht) — personal data fields,
  excluded from `vertragstext`.
- **Body** — from "Der Tandempassagier erklärt seinen Beitritt beim
  HFSC-Freistadt..." (page 1) through "...keine Fragen dazu mehr bestehen."
  (page 2). This is the `vertragstext`.
- **Page 2 signature block** (Ort/Datum/Unterschrift) — excluded from
  `vertragstext`; handled separately as auto-filled PDF fields (see §3).

Change: hardcode the extracted body text as the new default value of
`Config.contractText` in `src/server/config.ts` (currently `''`). No new
editing UI is introduced — the existing `GET/PUT /api/settings` and
`GET /api/contract` mechanism is unchanged, only the shipped default text
changes.

## 2. Workflow reorder (contract + signature)

**Current:** welcome → contract (checkbox accept) → form → sign (canvas) →
done. Signing happens two screens after the contract is shown.

**New:** welcome → form → contract+sign (combined screen) → done.

- `Contract.tsx` is extended with a signature canvas below the contract text.
  The "Ich akzeptiere die Bedingungen" checkbox is removed — drawing a
  signature *is* the acceptance, matching the paper form (read the text, sign
  at the bottom, one act).
- The canvas drawing logic currently in `Sign.tsx` moves into `Contract.tsx`
  (or a small shared component/hook used by both, if that's cleaner during
  implementation); `Sign.tsx` is retired as a standalone screen.
- `App.tsx`: `Screen` becomes `'welcome' | 'form' | 'contract' | 'done'`. The
  combined screen's `onNext` carries both the signature data URL and fires the
  same submit path that used to live in `handleSign`.
- Form now runs *before* Contract, since the contract's header fields (name,
  address, etc.) come from data the guest just entered. The contract text
  itself is static and does not need to interpolate guest data on screen.

## 3. PDF fill approach

The template is **not** an AcroForm — it's flat text with underline blanks.
So filling means drawing text/image on top of the existing page content at
fixed coordinates, not setting named form field values.

- New dependency: `pdf-lib`.
- New module `src/server/contractPdf.ts` exporting
  `fillContractPdf(templateBytes: Uint8Array, data: ContractPdfData): Promise<Buffer>`.
- Coordinates are measured directly against the real template's page
  geometry (via `pdf-lib`'s `page.getSize()` plus manual measurement against
  the actual PDF) during implementation — no more "coordinates TBD" guessing
  like the old `Print.tsx` had to do before the club supplied real measurements.
- Fields drawn:
  - Page 1: Herr/Frau `<first_name> <last_name>`, Straße und Hausnummer,
    PLZ und Wohnort, Telefon, E-Mail, Alter, Größe, Gewicht.
  - Page 2: Ort (from `Config.jumpLocation`, §5), Datum (registration date),
    signature image (drawn from the canvas PNG data URL) at the Unterschrift
    line.
  - **Left blank:** Tandemmaster, Gutschein Nr. — both are assigned later by
    staff in the manifest app, unknown at kiosk signing time. The generated
    PDF is written once, at signing, and is not regenerated when these are
    later assigned.

## 4. Storage

- DB: new column `registrations.contract_pdf_filename TEXT`, **replacing**
  `signature_png` (dropped — the app is early-stage with no production data
  depending on that column; no need to carry it forward).
- File: written to
  `<exportDir>/vertaege/<yyyy.mm.dd>_<lastname>-<firstname>.pdf`. On a
  same-day name collision, append ` (2)`, ` (3)`, etc. until the filename is
  free.
- New route `GET /api/registrations/:id/contract.pdf`: looks up the
  filename, streams the file from `<exportDir>/vertaege/`, responds
  `Content-Type: application/pdf`, `Content-Disposition: inline`.
- `POST /api/registrations` flow: validate input → build the filled PDF via
  `contractPdf.ts` → write it to `<exportDir>/vertaege/` → insert the
  registration row with `contract_pdf_filename` set. The raw signature data
  URL is used only in-memory to build the PDF; it is never persisted as its
  own DB value.

## 5. Settings: Ort field

- New `Config.jumpLocation: string` (default `''`), persisted the same way as
  `exportDir`/`contractText` via `config.json`.
- Exposed as a new input field in the manifest `Settings.tsx`, alongside the
  existing Export-Verzeichnis field. `PUT /api/settings` already merges
  arbitrary keys from the request body, so no server-side route change is
  needed beyond adding the field to the `Config`/`Settings` types.

## 6. Manifest cleanup

- `Detail.tsx`: the "Drucken" button changes from `window.print()` (over the
  coordinate-guess overlay) to opening
  `/api/registrations/:id/contract.pdf` in a new tab — the real signed
  document, printable from the browser's own PDF viewer.
- `Print.tsx`, `print.css`, and the print-sheet wiring in manifest `App.tsx`
  are deleted. That overlay existed only as a stand-in until the club
  supplied real coordinates for the paper form — it's now fully superseded by
  filling the actual template.
- `web/manifest/src/api.ts`: `Registration.signature_png` removed,
  `Registration.contract_pdf_filename` added.

## 7. Packaging

The template PDF is a server-side asset (not part of `web/*/dist`), so it
needs its own embedding path for the packaged `.exe`, separate from
`pkg.config.json`'s current `web/guest/dist/**/*` / `web/manifest/dist/**/*`
asset list. Add the template to that `assets` list (e.g.
`assets/Befoerderungsvertrag.pdf`) and load it in `contractPdf.ts` the same
way other packaged-vs-dev path resolution is already handled in
`src/server/main.ts`.

## 8. Testing

- `Sign.test.tsx`'s canvas-mocking approach moves to cover the merged
  `Contract.tsx` (drawing still exercised the same way; checkbox assertions
  removed).
- `tests/e2e/flow.spec.ts` updated for the new step order (form before
  contract, no checkbox, single combined contract+sign screen).
- New server-side test for `contractPdf.ts`: output starts with `%PDF`, has a
  non-trivial byte size, and the registration row's
  `contract_pdf_filename` points at a file that actually exists on disk
  after `POST /api/registrations`.

## Non-goals

- No regeneration of the PDF when Tandemmaster/Gutschein-Nr are assigned
  later in the manifest app (explicit decision, §3).
- No new UI for editing `contractText` (unchanged from today — still a
  config-file default).
