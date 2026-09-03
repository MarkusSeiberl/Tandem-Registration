# Gutschein-Nr. bei der Registrierung — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Gast kann seine Gutschein-Nr. schon am Anmelde-Tablet eintragen; die Zeile erreicht das Manifest mit gesetzter Zahlungsart `voucher`, gefüllter Nummer und gestempeltem Vertrag.

**Architecture:** Ein neues, als einziges optionales Feld im Gastformular (`web/guest/src/Form.tsx`), als letzte Station der bestehenden Feldkette (`useFieldChain.ts`). Der Wert reist als optionales `voucher_number` im bestehenden Registrierungs-Payload, wird in `validateGuest` geprüft und beim `INSERT` zusammen mit `payment_method='voucher'` geschrieben. Der Vertrag wird beim Anlegen gestempelt, weil der Nachstempel in `PATCH` nur bei einer *Änderung* der Nummer läuft. Das Manifest bleibt unverändert.

**Tech Stack:** TypeScript, React 19 (Gast-PWA, Vite), Fastify 5 + better-sqlite3 (Server), Vitest (Unit, zwei getrennte Configs), Playwright (E2E), pdf-lib (Vertragsstempel).

Spec: `docs/superpowers/specs/2026-09-03-gutschein-nr-bei-registrierung-design.md`

## Global Constraints

- Alle Beschriftungen, Hinweise und Fehlermeldungen auf Deutsch.
- Feldbeschriftung exakt: `Gutschein-Nr. (optional)`. Hinweistext exakt: `Falls du einen Gutschein hast.`
- Einleitungszeile des Formulars exakt: `Alle Felder sind Pflichtfelder – bis auf die Gutschein-Nr.` (Halbgeviertstrich `–`, kein Bindestrich).
- Serverfehler exakt: `Gutschein-Nr. ungültig`.
- Maximale Länge der Nummer: **60 Zeichen nach `trim()`**.
- Leerer/fehlender Wert ⇒ die Registrierung hat keine Nummer; `voucher_number` bleibt `NULL` und `payment_method` bleibt `NULL`.
- Kein Aufruf von `/api/voucher` aus der Gast-App. Der Gast sieht kein Listen-Urteil.
- Kein `inputMode` und kein `pattern` auf dem Feld.
- Keine Änderung an `web/manifest/**`.
- Keine Datenbank-Migration: `voucher_number` und `payment_method` existieren bereits (`src/server/db.ts`).
- Kommentarstil des Repos beibehalten: Kommentare erklären das *Warum*, nicht das *Was*. Serverdateien und Gast-App kommentieren auf Englisch, Specs und Commit-Botschaften auf Deutsch.

**Testbefehle** (aus dem Repo-Root):

| Was | Befehl |
| --- | --- |
| Server-Unit-Tests | `npm test` |
| Gast-App-Unit-Tests | `npm --prefix web/guest run test` |
| E2E | `npm run build:web && npm run test:e2e` |

---

### Task 1: Die Feldkette bekommt eine letzte Station

**Files:**
- Modify: `web/guest/src/useFieldChain.ts`
- Test: `web/guest/src/useFieldChain.test.ts`

**Interfaces:**
- Consumes: nichts (erste Aufgabe).
- Produces: `FieldName` enthält zusätzlich `'voucherNumber'`; `FIELD_CHAIN` endet auf `'voucherNumber'`; `nextField('phone') === 'voucherNumber'`; `nextField('voucherNumber') === null`. Task 2 baut darauf auf.

- [ ] **Step 1: Den fehlschlagenden Test schreiben**

In `web/guest/src/useFieldChain.test.ts` den bestehenden `FIELD_CHAIN`-Test ersetzen:

```tsx
describe('FIELD_CHAIN', () => {
  it('lists all twelve fields in the order they appear in the form', () => {
    expect(FIELD_CHAIN).toEqual([
      'firstName',
      'lastName',
      'gender',
      'age',
      'height',
      'weight',
      'street',
      'postalCode',
      'city',
      'email',
      'phone',
      'voucherNumber',
    ])
  })
})
```

Im `describe('nextField')`-Block den Test `stops at the last field instead of wrapping around` ersetzen durch:

```tsx
  it('carries on from the last mandatory field into the optional one', () => {
    expect(nextField('phone')).toBe('voucherNumber')
  })

  it('stops at the last field instead of wrapping around', () => {
    expect(nextField('voucherNumber')).toBeNull()
  })
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `npm --prefix web/guest run test -- useFieldChain`
Expected: FAIL — `expected [ …, 'phone' ] to deeply equal [ …, 'phone', 'voucherNumber' ]`, und `nextField('phone')` liefert `null` statt `'voucherNumber'`.

- [ ] **Step 3: Die Kette erweitern**

In `web/guest/src/useFieldChain.ts` das Array-Ende ändern und den Kommentar über `FIELD_CHAIN` um einen Absatz ergänzen:

```ts
// `gender` is a radio group, not a text input, but it occupies one station in
// the chain like everything else — skipping it would leave the one field that
// cannot be reached with an Enter key unreachable by the arrows too.
//
// `voucherNumber` is the one optional field of the form and sits last. Being in
// the chain is what makes Enter on `phone` move on instead of submitting, and
// what makes the arrows reach it; `validate()` never puts an error on it, so
// `firstErrorField` can never send the guest here.
export const FIELD_CHAIN = [
  'firstName',
  'lastName',
  'gender',
  'age',
  'height',
  'weight',
  'street',
  'postalCode',
  'city',
  'email',
  'phone',
  'voucherNumber',
] as const
```

- [ ] **Step 4: Test laufen lassen, Erfolg bestätigen**

Run: `npm --prefix web/guest run test -- useFieldChain`
Expected: PASS, alle Tests der Datei grün.

- [ ] **Step 5: Committen**

```bash
git add web/guest/src/useFieldChain.ts web/guest/src/useFieldChain.test.ts
git commit -m "feat(gutschein): Feldkette endet auf der optionalen Gutschein-Nr."
```

---

### Task 2: Das optionale Feld im Gastformular

**Files:**
- Modify: `web/guest/src/Form.tsx`
- Modify: `web/guest/src/index.css`
- Test: `web/guest/src/Form.test.tsx`

**Interfaces:**
- Consumes: `FIELD_CHAIN` mit `'voucherNumber'` als letzter Station (Task 1).
- Produces: `FormValues` bekommt `voucher_number?: string` (nur gesetzt, wenn der Gast etwas getippt hat). `onNext` liefert das Feld **gar nicht** mit, wenn es leer ist. Task 3 verlässt sich auf diese Form.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An `web/guest/src/Form.test.tsx` anhängen, innerhalb des bestehenden `describe('Form', …)`:

```tsx
  it('lets the guest submit without a voucher number', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)

    const submit = screen.getByRole('button', { name: 'Weiter' })
    expect(submit).toBeEnabled()
    await user.click(submit)

    // Absent, not empty: nothing the guest did not type reaches the server.
    expect(onNext).toHaveBeenCalledTimes(1)
    expect(onNext.mock.calls[0][0]).not.toHaveProperty('voucher_number')
  })

  it('is the only field that is not marked required', () => {
    render(<Form onNext={vi.fn()} />)

    expect(screen.getByLabelText('Gutschein-Nr. (optional)')).not.toBeRequired()
    expect(screen.getByLabelText('Telefon')).toBeRequired()
  })

  it('passes a typed voucher number on, trimmed', async () => {
    const user = userEvent.setup()
    const onNext = vi.fn()
    render(<Form onNext={onNext} />)

    await fillValid(user)
    await user.type(screen.getByLabelText('Gutschein-Nr. (optional)'), '  GS-2026-0042  ')
    await user.click(screen.getByRole('button', { name: 'Weiter' }))

    expect(onNext.mock.calls[0][0].voucher_number).toBe('GS-2026-0042')
  })

  it('keeps the voucher number when the guest comes back from the contract', () => {
    render(
      <Form
        onNext={vi.fn()}
        initialValues={{
          first_name: 'Anna', last_name: 'Muster', gender: 'female',
          age: 30, height_cm: 170, weight_kg: 70,
          street: 'Hauptstraße 1', postal_code: '4240', city: 'Freistadt',
          email: 'anna@example.com', phone: '0664 1234567',
          voucher_number: 'GS-2026-0042',
        }}
      />
    )

    expect(screen.getByLabelText('Gutschein-Nr. (optional)')).toHaveValue('GS-2026-0042')
  })
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npm --prefix web/guest run test -- Form`
Expected: FAIL — `Unable to find a label with the text of: Gutschein-Nr. (optional)`.

- [ ] **Step 3: Das Feld einbauen**

`web/guest/src/Form.tsx`, fünf zusammenhängende Änderungen.

(a) `FormValues`, `RawValues` und `EMPTY` erweitern:

```tsx
export interface FormValues {
  first_name: string
  last_name: string
  gender: Gender
  age: number
  height_cm: number
  weight_kg: number
  street: string
  postal_code: string
  city: string
  email: string
  phone: string
  /** The one optional datum of this form — absent when the guest has none. */
  voucher_number?: string
}
```

```tsx
interface RawValues {
  firstName: string
  lastName: string
  gender: Gender | ''
  age: string
  height: string
  weight: string
  street: string
  postalCode: string
  city: string
  email: string
  phone: string
  voucherNumber: string
}
```

```tsx
const EMPTY: RawValues = {
  firstName: '',
  lastName: '',
  gender: '',
  age: '',
  height: '',
  weight: '',
  street: '',
  postalCode: '',
  city: '',
  email: '',
  phone: '',
  voucherNumber: '',
}
```

`Errors` bleibt unverändert: Dieses Feld kann keinen Fehler tragen.

(b) `toRaw` um die Rückübersetzung ergänzen:

```tsx
    phone: values.phone,
    voucherNumber: values.voucher_number ?? '',
  }
}
```

(c) `field()` ein `optional`-Flag geben — sonst trägt jedes Feld `required`:

```tsx
  // Every field here is mandatory except the voucher number — `required` and
  // aria-required say so before the guest has left a field empty, which the
  // error messages can only do afterwards. The form keeps `noValidate`, so the
  // browser's own English bubbles stay out of the way of the German messages.
  function field(name: keyof RawValues, optional = false) {
    const isLast = name === LAST_FIELD
    return {
      value: values[name],
      required: !optional,
      'aria-required': !optional,
```

Der Rest von `field()` bleibt unverändert.

(d) In `attemptSubmit` bleibt `setTouched` unverändert (ein Feld ohne Fehler braucht kein `touched`); der `onNext`-Aufruf wird ergänzt:

```tsx
    const voucherNumber = values.voucherNumber.trim()
    onNext({
      first_name: values.firstName.trim(),
      last_name: values.lastName.trim(),
      // isValid guarantees gender !== '', which the compiler cannot see.
      gender: values.gender as Gender,
      age: Number(values.age),
      height_cm: Number(values.height),
      weight_kg: Number(values.weight),
      street: values.street.trim(),
      postal_code: values.postalCode.trim(),
      city: values.city.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      // Left out entirely when empty: an absent number and an empty string
      // would otherwise be two ways of saying the same thing, and only one of
      // them survives the trip through the API.
      ...(voucherNumber === '' ? {} : { voucher_number: voucherNumber }),
    })
```

(e) Das Feld-Set hinter dem `Kontakt`-Feld-Set einfügen, direkt vor `<div className="actions">`:

```tsx
        {/*
          Its own group rather than a line under Kontakt: a voucher number is
          not a contact detail, and the legend would say something untrue. Last,
          because a guest without a voucher should not meet a field that is none
          of their business before their own name.
        */}
        <fieldset className="field-group">
          <legend>Gutschein</legend>

          <div className="field">
            <label htmlFor="voucher_number">Gutschein-Nr. (optional)</label>
            {/* No inputMode: club numbers are not reliably numeric, and a digit
                pad would shut out exactly the ones that carry letters. */}
            <input id="voucher_number" type="text" {...field('voucherNumber', true)} />
            <p className="field-note">Falls du einen Gutschein hast.</p>
          </div>
        </fieldset>
```

Und die Einleitungszeile ändern:

```tsx
      <p className="form-intro">Alle Felder sind Pflichtfelder – bis auf die Gutschein-Nr.</p>
```

- [ ] **Step 4: Den Hinweis stylen**

In `web/guest/src/index.css` direkt hinter dem `.error`-Block (aktuell Zeile 481–485) einfügen:

```css
/* The quiet sibling of .error: a note that is always there, not a verdict on
   what the guest typed. Same rhythm, muted rather than red. */
.field-note {
  font-size: 16px;
  margin: 6px 0 0;
  opacity: 0.7;
}
```

- [ ] **Step 5: Tests laufen lassen, Erfolg bestätigen**

Run: `npm --prefix web/guest run test`
Expected: PASS — alle Dateien der Gast-App grün, inklusive der vier neuen Fälle.

- [ ] **Step 6: Typprüfung**

Run: `npm --prefix web/guest run build`
Expected: Erfolg, kein `tsc`-Fehler.

- [ ] **Step 7: Committen**

```bash
git add web/guest/src/Form.tsx web/guest/src/Form.test.tsx web/guest/src/index.css
git commit -m "feat(gutschein): Gastformular nimmt die Gutschein-Nr. entgegen"
```

---

### Task 3: Der Payload trägt die Nummer, der Server prüft sie

**Files:**
- Modify: `web/guest/src/api.ts`
- Modify: `src/server/validation.ts`
- Test: `tests/validation.test.ts`

**Interfaces:**
- Consumes: `FormValues.voucher_number?: string` aus Task 2.
- Produces: `RegistrationPayload.voucher_number?: string`; `GuestInput.voucher_number?: string` — nach `validateGuest` entweder ein nicht-leerer, getrimmter String oder gar nicht vorhanden. Task 4 verlässt sich darauf, dass der Wert bereits getrimmt und nie `''` ist.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An `tests/validation.test.ts` anhängen:

```ts
// The only optional field of the form. Absent and empty mean the same thing:
// this guest has no voucher.
test('a registration without a voucher number is valid', () => {
  expect(validateGuest(base).ok).toBe(true)
  const r = validateGuest({ ...base, voucher_number: '   ' })
  expect(r.ok).toBe(true)
  expect((r as any).value.voucher_number).toBeUndefined()
})

test('a voucher number is trimmed and kept', () => {
  const r = validateGuest({ ...base, voucher_number: '  GS-2026-0042 ' })
  expect(r.ok).toBe(true)
  expect((r as any).value.voucher_number).toBe('GS-2026-0042')
})

// Not a format rule — a brake. A jammed scanner must not write a novel into
// the database.
test('rejects a voucher number longer than 60 characters', () => {
  const r = validateGuest({ ...base, voucher_number: 'G'.repeat(61) })
  expect(r.ok).toBe(false)
  expect((r as any).errors).toContain('Gutschein-Nr. ungültig')
  expect(validateGuest({ ...base, voucher_number: 'G'.repeat(60) }).ok).toBe(true)
})

test('rejects a voucher number that is not a string', () => {
  expect(validateGuest({ ...base, voucher_number: 42 }).ok).toBe(false)
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npm test -- validation`
Expected: FAIL — `expected undefined to be 'GS-2026-0042'`, und `expected true to be false` beim Längentest.

- [ ] **Step 3: `validateGuest` erweitern**

In `src/server/validation.ts` das Interface ergänzen:

```ts
export interface GuestInput {
  first_name: string; last_name: string; gender: Gender
  age: number; height_cm: number; weight_kg: number
  street: string; postal_code: string; city: string
  email: string; phone: string
  /** The one field a guest may leave empty. Absent, never ''. */
  voucher_number?: string
  signature_png: string; accepted_terms: true; privacy_ack: true
}
```

Die abschließende Zeile

```ts
  return e.length ? { ok: false, errors: e } : { ok: true, value: input as GuestInput }
```

ersetzen durch:

```ts
  // The one optional field. Absent, empty and whitespace all mean "this guest
  // has no voucher", and all three leave the row's voucher_number NULL — an ''
  // in the column would look like a number nobody can look up.
  const raw = input?.voucher_number
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    e.push('Gutschein-Nr. ungültig')
  }
  const voucher = typeof raw === 'string' ? raw.trim() : ''
  // A cap rather than a format: the club's number ranges change over the years,
  // and matching against the list is normaliseVoucherNumber's job anyway. This
  // only stops a jammed scanner from writing a novel into the column.
  if (voucher.length > 60) e.push('Gutschein-Nr. ungültig')

  if (e.length) return { ok: false, errors: e }
  // Copied rather than handed through: this is the one field the validator
  // normalises, and mutating the request body would do it behind the caller's
  // back.
  const value = { ...input } as GuestInput
  if (voucher === '') delete value.voucher_number
  else value.voucher_number = voucher
  return { ok: true, value }
}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg bestätigen**

Run: `npm test -- validation`
Expected: PASS, alle Tests der Datei grün.

- [ ] **Step 5: Den Payload-Typ nachziehen**

In `web/guest/src/api.ts`, im `RegistrationPayload`-Interface hinter `phone`:

```ts
  phone: string
  // The one field the guest may leave blank. Omitted rather than sent empty:
  // the server treats absent and '' alike, and omitting keeps the wire honest.
  voucher_number?: string
  signature_png: string
```

`web/guest/src/App.tsx` braucht keine Änderung — `handleSign` spreizt `...formValues` in den Payload, ein fehlendes `voucher_number` bleibt damit von selbst fort. **Nachsehen und bestätigen**, nicht blind überspringen.

- [ ] **Step 6: Typprüfung beider Seiten**

Run: `npm --prefix web/guest run build`
Expected: Erfolg.

Run: `npx tsc -b`
Expected: Erfolg, kein Fehler.

- [ ] **Step 7: Committen**

```bash
git add web/guest/src/api.ts src/server/validation.ts tests/validation.test.ts
git commit -m "feat(gutschein): Registrierung nimmt eine optionale Gutschein-Nr. an"
```

---

### Task 4: Angelegte Zeile trägt Nummer, Zahlungsart und Stempel

**Files:**
- Modify: `src/server/routes/registrations.ts:52-105` (der `POST /api/registrations`-Handler)
- Test: `tests/registrations.test.ts`

**Interfaces:**
- Consumes: `GuestInput.voucher_number?: string` — bereits getrimmt und nie `''` (Task 3).
- Produces: keine neuen Exporte. Verhalten, auf das Task 5 sich verlässt: eine Registrierung mit Nummer erzeugt eine Zeile mit `voucher_number = <Nummer>` und `payment_method = 'voucher'`; ohne Nummer bleiben beide `NULL`.

- [ ] **Step 1: Die fehlschlagenden Tests schreiben**

An `tests/registrations.test.ts` anhängen (`pdfContains`, `validBody` und `testServer` stehen bereits oben in der Datei):

```ts
// The guest holds the voucher while filling the tablet in; typing it there is
// the same transcription the operator would otherwise do at the desk.
test('a guest who brings a voucher arrives on the voucher payment method', async () => {
  const { app } = testServer()
  await app.inject({
    method: 'POST', url: '/api/registrations',
    payload: { ...validBody(), voucher_number: 'GS-2026-0042' },
  })
  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]

  expect(row.voucher_number).toBe('GS-2026-0042')
  expect(row.payment_method).toBe('voucher')
  // The covered service is still the operator's decision, so nothing is taken
  // off the bill yet: the row starts at the plain jump price.
  expect(row.voucher_service).toBeNull()
  expect(row.price).toBe(270)
  await app.close()
})

test('a guest without a voucher leaves both columns empty', async () => {
  const { app } = testServer()
  await app.inject({ method: 'POST', url: '/api/registrations', payload: validBody() })
  const row = (await app.inject({ method: 'GET', url: '/api/registrations' })).json()[0]

  expect(row.voucher_number).toBeNull()
  expect(row.payment_method).toBeNull()
  await app.close()
})

// Required, not a nicety: the PATCH restamp only fires when the number
// *changes*, so an operator saving the guest's number unchanged would leave the
// contract blank forever.
test('the number the guest typed is on the contract before anyone opens the row', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-guest-stamp-'))
  const { app } = testServer({ exportDir })
  await app.inject({
    method: 'POST', url: '/api/registrations',
    payload: { ...validBody(), voucher_number: 'GS-2026-0042' },
  })
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename

  expect(await pdfContains(path.join(exportDir, 'vertaege', filename), 'GS-2026-0042'))
    .toBe(true)
  await app.close()
})

// The stamp is re-drawn as a whole from the row, so assigning a master later
// must not push the guest's own number off the page.
test('a later tandem master keeps the guest voucher number on the contract', async () => {
  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-guest-restamp-'))
  const { app, db } = testServer({ exportDir })
  const { id } = (await app.inject({
    method: 'POST', url: '/api/registrations',
    payload: { ...validBody(), voucher_number: 'GS-2026-0042' },
  })).json()
  const filename = (await app.inject({ method: 'GET', url: '/api/registrations' }))
    .json()[0].contract_pdf_filename
  const masterId = db.prepare("INSERT INTO tandem_masters (name, active) VALUES ('Eva Berger', 1)")
    .run().lastInsertRowid

  await app.inject({
    method: 'PATCH', url: `/api/registrations/${id}`,
    payload: { tandem_master_id: masterId },
  })

  const pdfPath = path.join(exportDir, 'vertaege', filename)
  expect(await pdfContains(pdfPath, 'GS-2026-0042')).toBe(true)
  expect(await pdfContains(pdfPath, 'Eva Berger')).toBe(true)
  await app.close()
})
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `npm test -- registrations`
Expected: FAIL — `expected null to be 'GS-2026-0042'` im ersten neuen Test, `expected false to be true` im Stempel-Test.

- [ ] **Step 3: Den POST-Handler anpassen**

In `src/server/routes/registrations.ts`, im `POST /api/registrations`-Handler.

(a) Nach `fillContractPdf` und **vor** `writeContractPdf` stempeln:

```ts
    // A number the guest brought has to reach the PDF here, not later: the
    // restamp in PATCH only runs when the number *changes*, so an operator who
    // saves the guest's number unchanged would leave the contract blank for
    // good. Unlike that restamp this one is not best-effort — it happens on
    // bytes that are not a file yet, so a failure fails the registration the
    // same way a failed fillContractPdf does, and no half-stamped contract can
    // reach the disk. Nobody is flying this jump yet, hence no Tandemmaster.
    const stamped = v.voucher_number
      ? await stampContract(pdf, { voucherNumber: v.voucher_number, tandemMaster: null })
      : pdf
    const filename = await writeContractPdf(vertraegeDir, base, stamped)
```

(b) Das `INSERT` um beide Spalten erweitern:

```ts
    const info = db.prepare(`INSERT INTO registrations
      (first_name,last_name,gender,age,height_cm,weight_kg,
       street,postal_code,city,email,phone,contract_pdf_filename,
       accepted_terms,privacy_ack_at,created_at,jump_date,
       voucher_number,payment_method,
       extra_booking,weight_surcharge,price,price_override)
      VALUES (@first_name,@last_name,@gender,@age,@height_cm,@weight_kg,
       @street,@postal_code,@city,@email,@phone,
       @contract_pdf_filename,1,@privacy_ack_at,@created_at,@jump_date,
       @voucher_number,@payment_method,
       'none',@weight_surcharge,@price,0)`)
      .run({
        ...v, contract_pdf_filename: filename, created_at: new Date().toISOString(),
        // The server's clock, not the tablet's: when a guest acknowledged the
        // data-protection notice is a record the club may have to stand behind.
        privacy_ack_at: new Date().toISOString(),
        jump_date: jumpDate, weight_surcharge: weightSurcharge,
        // A guest who writes down a voucher number has said how they mean to
        // pay, so the row reaches the manifest on that method with the list's
        // verdict already beside the field. It is not binding: paying cash
        // after all is one select away, and the manifest clears the number with
        // it. The price is untouched either way — voucherCovered needs a
        // voucher_service, and choosing that stays the operator's job.
        //
        // Both are named explicitly because `...v` carries voucher_number only
        // when the guest sent one, and better-sqlite3 refuses a statement whose
        // named parameter has no value at all.
        voucher_number: v.voucher_number ?? null,
        payment_method: v.voucher_number ? 'voucher' : null,
        price: computePrice({ weight_surcharge: weightSurcharge }, dayPrices),
      })
```

(c) `stampContract` ist bereits importiert (`src/server/routes/registrations.ts:7`). Nachsehen, nicht doppelt importieren.

- [ ] **Step 4: Tests laufen lassen, Erfolg bestätigen**

Run: `npm test -- registrations`
Expected: PASS, alle Tests der Datei grün — auch die bestehenden Stempel-Tests, die ohne Gastnummer anlegen.

- [ ] **Step 5: Die ganze Server-Suite laufen lassen**

Run: `npm test`
Expected: PASS. Besonders `tests/export.test.ts` und `tests/voucher-route.test.ts` müssen grün bleiben: eine Zeile mit `payment_method='voucher'`, aber ohne `paid_at`, darf weder in den Kassenstand noch in den Einlöse-Zähler geraten.

- [ ] **Step 6: Committen**

```bash
git add src/server/routes/registrations.ts tests/registrations.test.ts
git commit -m "feat(gutschein): Angelegte Zeile trägt Nummer, Zahlungsart und Stempel"
```

---

### Task 5: Der E2E-Durchlauf kennt das neue letzte Feld

**Files:**
- Modify: `tests/e2e/flow.spec.ts`

**Interfaces:**
- Consumes: Formularfeld, Kette und Serververhalten aus Task 1–4.
- Produces: nichts.

Drei bestehende Tests stoßen auf das neue Feld: Die Enter-Kette endet nicht mehr auf `Telefon`, die Pfeil-Kette auch nicht, und der Durchlauf soll beweisen, dass eine vom Gast getippte Nummer im Manifest ankommt.

- [ ] **Step 1: Den Happy-Path um die Nummer erweitern**

`GUEST` ergänzen:

```ts
  phone: '0660123456',
  voucherNumber: 'GS-2026-0042',
}
```

Im ersten Test hinter `await page.getByLabel('Telefon').fill(GUEST.phone)` einfügen:

```ts
  await page.getByLabel('Gutschein-Nr. (optional)').fill(GUEST.voucherNumber)
```

- [ ] **Step 2: Die Erwartungen im Manifest umstellen**

Im selben Test den Gutschein-Block ersetzen. Bisher steht dort, dass Feld und Leistung verborgen sind, bis `Zahlungsart` auf `voucher` gestellt wird; mit einer vom Gast getippten Nummer sind sie von Anfang an da. Aus

```ts
  const voucherField = page.getByLabel('Gutschein-Nr.')
  const voucherService = page.getByLabel('Gutschein-Leistung')
  const voucherTill = page.getByLabel('Zuzahlung bezahlt mit')
  await expect(voucherField).toBeHidden()
  await expect(voucherService).toBeHidden()
  await page.getByLabel('Zahlungsart').selectOption('voucher')
  await expect(voucherField).toBeVisible()
  await expect(voucherService).toBeVisible()
```

wird

```ts
  // The guest brought the number, so the row opens on Gutschein with the field
  // already filled — the operator only picks the covered service and the till.
  const voucherField = page.getByLabel('Gutschein-Nr.')
  const voucherService = page.getByLabel('Gutschein-Leistung')
  const voucherTill = page.getByLabel('Zuzahlung bezahlt mit')
  await expect(page.getByLabel('Zahlungsart')).toHaveValue('voucher')
  await expect(voucherField).toBeVisible()
  await expect(voucherField).toHaveValue(GUEST.voucherNumber)
  await expect(voucherService).toBeVisible()
```

Der Rest bleibt unverändert: Der Test stellt danach ohnehin auf `card` um und prüft, dass der ganze Gutschein-Block verschwindet — genau der Weg eines Gastes, der am Tisch doch mit Karte zahlt.

- [ ] **Step 3: Die Enter-Kette bis ans neue Ende führen**

Im Test `guest fills the whole form using only the Enter key` aus

```ts
  // Last field: Enter submits rather than moving on.
  await expect(page.getByLabel('Telefon')).toBeFocused()
  await page.keyboard.type(GUEST.phone)
  await page.keyboard.press('Enter')
```

machen:

```ts
  // Telefon is no longer the end of the chain: Enter carries on into the one
  // optional field instead of submitting from here.
  await expect(page.getByLabel('Telefon')).toBeFocused()
  await page.keyboard.type(GUEST.phone)
  await page.keyboard.press('Enter')

  // Last field: Enter submits rather than moving on — and it submits whether or
  // not the guest typed anything here.
  await expect(page.getByLabel('Gutschein-Nr. (optional)')).toBeFocused()
  await page.keyboard.press('Enter')
```

Den Kommentar über dem Test von `all eleven fields` auf `all twelve fields` ziehen.

- [ ] **Step 4: Das Ende der Pfeil-Kette umstellen**

Im Test `the arrow buttons walk the cursor and stop at both ends` den Schlussblock

```ts
  await page.getByLabel('Telefon').click()
  await expect(forward).toBeDisabled()
  await expect(back).toBeEnabled()
```

ersetzen durch

```ts
  await page.getByLabel('Gutschein-Nr. (optional)').click()
  await expect(forward).toBeDisabled()
  await expect(back).toBeEnabled()
```

- [ ] **Step 5: E2E laufen lassen**

Run: `npm run build:web && npm run test:e2e`
Expected: PASS, alle Specs in `tests/e2e/` grün.

- [ ] **Step 6: Committen**

```bash
git add tests/e2e/flow.spec.ts
git commit -m "test(gutschein): E2E führt die Gutschein-Nr. vom Tablet ins Manifest"
```

---

### Task 6: Gesamtlauf

**Files:** keine

- [ ] **Step 1: Alle drei Unit-Suiten**

Run: `npm test`
Expected: PASS

Run: `npm --prefix web/guest run test`
Expected: PASS

Run: `npm --prefix web/manifest run test`
Expected: PASS — das Manifest wurde nicht angefasst und muss unverändert grün sein.

- [ ] **Step 2: Linten**

Run: `npm --prefix web/guest run lint`
Expected: keine Befunde.

- [ ] **Step 3: Bauen**

Run: `npm run build:web && npm run build:server`
Expected: beide Builds erfolgreich.

- [ ] **Step 4: Den Stand prüfen**

Run: `git status --short`
Expected: Nur die drei Dateien, die schon vor diesem Vorhaben geändert waren und nicht dazugehören (`web/manifest/src/List.tsx`, `web/manifest/src/List.test.tsx`, `web/manifest/src/index.css`), stehen noch als geändert da. Nichts aus diesem Vorhaben ist uncommittet.
