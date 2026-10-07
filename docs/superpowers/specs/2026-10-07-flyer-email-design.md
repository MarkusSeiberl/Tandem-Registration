# Camera flyer email and crew editing — design

## Goal

Prepare for sending guest contact info to camera flyers by mail later:

- A camera flyer gets an optional email address.
- Crew entries (tandem masters and camera flyers) become editable: name for
  both, name and email for flyers.

Mail sending itself is out of scope.

## Decisions

- Email is optional. Existing flyers keep no email (`NULL`); nothing is
  backfilled.
- Email can be set when adding a flyer and changed or cleared later.
- Name is editable for masters and flyers. A rename shows up wherever the name
  is looked up by id (e.g. a re-export of an old day); xlsx files already
  written stay as they are.
- Basic email format check in the browser and on the server.
- Inline row editing in the Crew screen, no dialog.

## Database (`src/server/db.ts`)

- `CREATE TABLE camera_flyers` gets `email TEXT`.
- `migrate()` adds `email TEXT` to an existing `camera_flyers` table when the
  column is missing, guarded by `table_info(camera_flyers)` like the
  registrations migration. Idempotent, runs on every startup.

## API (`src/server/routes/stammdaten.ts`)

Generic `/api/:kind` route stays; `kind` is `masters` or `flyers`.

- `GET /api/flyers` returns `id, name, email`. `GET /api/masters` returns
  `id, name` as before.
- `POST /api/:kind` body `{ name, email? }`.
- New `PATCH /api/:kind/:id` body `{ name, email? }`. Returns the updated row
  (`id, name` plus `email` for flyers). 404 when the id does not exist or is
  inactive.

Validation, shared by POST and PATCH in one helper:

- `name` trimmed, required — else 400 `{ error: 'Name fehlt' }`.
- `email` trimmed; missing or empty is stored as `NULL`.
- Non-empty email must match `^[^\s@]+@[^\s@]+\.[^\s@]+$` — else 400
  `{ error: 'E-Mail ungültig' }`.
- A non-empty email for `masters` — 400 `{ error: 'E-Mail nur für Kameraflieger' }`.
- On PATCH for flyers, an omitted `email` clears it like an empty one: the
  edit row always sends both fields.

## API client (`web/manifest/src/api.ts`)

- `StammdatenItem` gets `email?: string | null`.
- `addKind(kind, name, email?)` sends `email` only when given.
- New `updateKind(kind, id, { name, email? })` → `PATCH`, throws with the server
  error message on failure.
- Exports: `addFlyer(name, email?)`, `updateMaster(id, name)`,
  `updateFlyer(id, name, email)`.

## Crew screen (`web/manifest/src/Crew.tsx`)

`CrewList` gets `withEmail: boolean` (true only for Kameraflieger) and an
`update` callback.

- Add row: name input, plus `type="email"` input with placeholder
  `E-Mail (optional)` when `withEmail`. Hinzufügen sends both and clears both.
- Each row: name, email in grey under it when present (nothing when absent),
  pencil button (`aria-label="<name> bearbeiten"`) before the trash button.
- Pencil turns that row into name input (+ email input when `withEmail`) with
  Speichern and Abbrechen. One row in edit mode at a time; opening another
  discards the first. Enter saves, Escape cancels.
- Speichern disabled while busy or name empty. Server errors show in the
  existing `.error` line and the row stays in edit mode.
- Styles for the edit row and the email line go into `index.css` next to the
  `.crew-list` rules.

## Unchanged

Registrations, Detail, export, Excel and payouts. They use flyer `id` and
`name` only.

## Tests

- `tests/db.test.ts`: migration adds `email` to a `camera_flyers` table
  without it; existing rows read `NULL`.
- `tests/stammdaten.test.ts`: POST flyer with and without email; invalid email
  400; email on masters 400; GET masters has no `email` key; PATCH changes
  name and email, `''` clears email, unknown or inactive id 404, empty name 400.
- `web/manifest/src/Crew.test.tsx`: email input only in the flyer list; email
  shown under the name; edit saves via update and refreshes; Abbrechen leaves
  values unchanged.
