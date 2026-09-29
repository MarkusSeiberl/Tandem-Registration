# Tarife and Crew screens — design

## Goal

Split the manifest's "Stammdaten" screen in two:

- **Tarife** — prices (Preise) and payout rates (Vergütung), plus a new table of
  final tandem prices per combination.
- **Crew** — the tandem master and camera flyer lists (the old "Stammdaten" tab,
  renamed).

## Sidebar

Tabs become `Manifest · Tarife · Crew · Einstellungen` (update tab unchanged).
`View` in `web/manifest/src/App.tsx`: `'stammdaten'` is replaced by `'tarife'`
and `'crew'`.

## Tarife screen

New `web/manifest/src/Tarife.tsx` renders the existing `Betraege` component.
Inputs, validation and the single "Beträge speichern" button stay as they are.

Order inside `Betraege`:

1. Preise (EUR) inputs
2. Price table (new)
3. Vergütung (EUR) inputs
4. Error / saved messages, save button

## Price table

New pure component `web/manifest/src/PriceMatrix.tsx`.

- Prop: `prices: Partial<Prices>` — parsed from the live price inputs; a field
  that is empty, not a number or negative is left out.
- Columns: `ohne Zuschlag` · `ab 90 kg` · `ab 100 kg`
  (`weight_surcharge` = `none` / `over_90` / `over_100`).
- Rows: `Tandem` · `Tandem + Video` · `Tandem + Video + Foto`
  (`extra_booking` = `none` / `video` / `video_photo`).
- Cell value: `computePrice({ extra_booking, weight_surcharge }, prices)` from
  `web/manifest/src/pricing.ts`, formatted with `formatEuro`. No second copy of
  the price rule.
- A cell shows `–` when any price it needs is missing from `prices` (the jump,
  the row's extra, the column's surcharge). Other cells keep their values.
- Updates live while typing; it reflects the inputs, not what is saved.
- Heading `Endpreise`, rendered as a `<table>` with header row and header column.

## Crew screen

`web/manifest/src/Stammdaten.tsx` is renamed to `Crew.tsx` (component `Crew`,
inner list `CrewList`). It no longer renders `Betraege`.

In each list:

- The add row (text input + "Hinzufügen" button) moves above the list.
- Placeholder is `Vorname Nachname` for both lists; the `addLabel` prop goes away.

Backend untouched: the `/stammdaten` routes and the `StammdatenItem` /
`StammdatenKind` API types keep their names.

Comments that point at "the Stammdaten screen" (`Settings.tsx`, `date.ts`,
`Betraege.tsx`) are updated to name Tarife or Crew.

## Tests

- `PriceMatrix.test.tsx`: all nine sums for a known price set; an invalid
  `video` price blanks only the `Tandem + Video` row.
- `Betraege.test.tsx`: typing a new jump price updates the table live; existing
  tests keep passing.
- `Crew.test.tsx` (from `Stammdaten.test.tsx`): add input comes before the list,
  placeholder `Vorname Nachname`, no price block rendered.
- `App.test.tsx`, `tests/e2e/manifest-texts-and-date.spec.ts`,
  `tests/e2e/price-per-day.spec.ts`: navigate via `Tarife` / `Crew` instead of
  `Stammdaten`.
- `Settings.test.tsx` test name referencing Stammdaten updated.
