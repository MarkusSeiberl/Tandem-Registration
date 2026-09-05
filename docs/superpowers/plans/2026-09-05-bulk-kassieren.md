# Umsetzungsplan: Mehrere Tandems auf einmal kassieren

Design: `docs/superpowers/specs/2026-09-05-bulk-kassieren-design.md`

Alle Arbeit liegt in `web/manifest/`. Tests laufen dort mit `npm test`
(vitest run), Lint mit `npm run lint` (oxlint), Typen mit `npx tsc -b`.

## Global Constraints

Diese gelten für jeden Task und sind verbindlich:

1. **Sprache.** Sichtbarer Text ist Deutsch. Code-Kommentare sind Englisch,
   in dem erklärenden Ton, den `List.tsx` schon hat: sie sagen *warum*, nicht
   *was*. Neue Labels gehören nach `labels.ts`, wenn sie eine Enum-Domäne
   beschreiben — die Zahlungsart hat dort mit `COLLECTED_VIA` schon eine.
2. **Zahlungsart-Auswahl** ist `COLLECTED_VIA` aus `./labels` (Bar, Karte).
   Nie `PAYMENT_METHODS`. Kein Default — der Select startet auf `''` mit dem
   Platzhalter `– bitte wählen –` (U+2013 Halbgeviertstrich).
3. **Schreibregel** (exakt, keine Abweichung):
   ```ts
   const fields: ManifestPatch = { paid: true }
   if ((row.price ?? 0) > 0) {
     if (row.payment_method === 'voucher') fields.voucher_payment_method = method
     else fields.payment_method = method
   }
   ```
4. **Keine neuen Abhängigkeiten.** Kein Dialog-Package, keine Portal-Library.
   Ein natives `<dialog>` plus `showModal()`.
5. **CSS-Tokens.** Nur die vorhandenen Custom Properties aus `:root` in
   `index.css` (`--panel-bg`, `--border`, `--text`, `--accent`, `--error`,
   `--ember`, …). Keine neuen Farb-Literale außer in `rgba()`-Abstufungen
   bestehender Tokens, wie `.export-warning` es vormacht.
6. **Sauberer Baum.** Der Branch startet ohne offene Änderungen. Jeder Task
   committet genau die Dateien, die sein Abschnitt nennt, und lässt alles
   andere in Ruhe. Der Export-Button heißt seit Kurzem `Tagesabschluss` —
   Tests, die ihn suchen, verwenden diesen Namen.
7. **TDD.** Test zuerst, rot sehen, dann implementieren. Jeder Task endet mit
   grünem `npm test`, `npm run lint` und `npx tsc -b` im Verzeichnis
   `web/manifest/`.

---

## Task 1: `<dialog>`-Stub für jsdom

**Datei:** `web/manifest/src/setupTests.ts`

jsdom 29.1.1 kennt `HTMLDialogElement` und dessen `open`-Property, aber weder
`showModal()` noch `close()`. Ohne Stub wirft jeder Test, der den Dialog
mountet. Neben den vorhandenen `EventSource`-Stub, im gleichen Stil (Kommentar
sagt, warum er da ist):

```ts
// jsdom implements <dialog> as an element but not its modal methods, so any
// component that opens one throws on mount. The stub keeps `open` truthful —
// that is what the tests assert on — without pretending to be a top layer.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
}
```

**Verifikation:** `npm test` läuft unverändert grün (keine neue Testdatei in
diesem Task). `npx tsc -b` ist sauber.

**Commit:** `test(manifest): jsdom bekommt showModal und close für <dialog>`

---

## Task 2: `CollectDialog`-Komponente

**Dateien:** `web/manifest/src/CollectDialog.tsx` (neu),
`web/manifest/src/CollectDialog.test.tsx` (neu)

Reine Präsentation. Die Komponente importiert **nichts** aus `./api` außer
Typen, ruft kein `fetch`, kennt kein `patch`.

### Props

```ts
export interface CollectDialogProps {
  /** Die ausgewählten Zeilen, die noch offen sind. Nie leer. */
  rows: Registration[]
  /** Angehakte Zeilen, die schon kassiert sind — die Aktion lässt sie in Ruhe. */
  skippedCount: number
  /** Läuft die Schleife gerade. Sperrt alles, damit Escape nicht mitten hineinfährt. */
  busy: boolean
  error: string | null
  onConfirm: (method: CollectedVia) => void
  onCancel: () => void
}
```

### Verhalten

- `useRef<HTMLDialogElement>` + `useEffect(() => { ref.current?.showModal() }, [])`.
  Nur beim Mount — `List` mountet die Komponente erst, wenn der Dialog offen
  sein soll, und unmountet sie beim Schließen. Kein `open`-Prop.
- Das `cancel`-Event (Escape) ruft `onCancel`, aber nur wenn nicht `busy`;
  bei `busy` `event.preventDefault()`.
- Interner State: `const [method, setMethod] = useState<CollectedVia | ''>('')`.

### Inhalt (genaue Texte)

Überschrift (`<h2>`): `1 Tandem kassieren` bzw. `${rows.length} Tandems kassieren`.

Betrag: `Offener Betrag: ` + `formatEuro(sum)` aus `./pricing`, wobei
`sum = rows.reduce((s, r) => s + (r.price ?? 0), 0)`. Der Betrag steht in einem
`<span className="numeral">`, wie es die Tabelle für Geld auch macht.

Wenn `skippedCount > 0`, eine eigene Zeile:
- `1 bereits kassierte Zeile bleibt unverändert.`
- `${skippedCount} bereits kassierte Zeilen bleiben unverändert.`

Wenn `zeroCount = rows.filter((r) => (r.price ?? 0) <= 0).length` größer 0, eine
eigene Zeile:
- `1 Tandem ohne Restbetrag behält seine Zahlungsart.`
- `${zeroCount} Tandems ohne Restbetrag behalten ihre Zahlungsart.`

Ein `<label>Zahlungsart` mit `<select>`: erste Option `value=""`, Text
`– bitte wählen –`; danach `COLLECTED_VIA.map(...)`.

Bei `error`: `<p className="error">{error}</p>`.

Buttons: `Abbrechen` (`className="btn secondary"`, `onClick={onCancel}`) und
`Kassieren` (`className="btn primary"`, `onClick` ruft `onConfirm` mit der
gewählten Methode, Text `Wird kassiert…` solange `busy`).

`disabled`: Select und Abbrechen bei `busy`; Kassieren bei `busy` oder solange
keine Methode gewählt ist.

Wurzel-Markup:

```tsx
<dialog ref={ref} className="collect-dialog" onCancel={handleCancel} aria-labelledby="collect-dialog-title">
```

### Tests (`CollectDialog.test.tsx`)

Kleine `makeRow`-Fabrik lokal in der Datei (Vorbild: `List.test.tsx`, Zeile 33 ff.
— dort abschauen, aber nur in diese Datei schreiben, nicht in ein geteiltes
Modul extrahieren; zwei Testdateien sind kein Muster).

1. Summiert `price` über die übergebenen Zeilen und zeigt `690 €`; Überschrift
   nennt die Anzahl im Plural.
2. Eine einzelne Zeile ergibt `1 Tandem kassieren` (Singular).
3. `skippedCount={2}` zeigt `2 bereits kassierte Zeilen bleiben unverändert.`;
   `skippedCount={0}` zeigt keine solche Zeile.
4. Eine Zeile mit `price: 0` erzeugt den Hinweis `1 Tandem ohne Restbetrag
   behält seine Zahlungsart.`; ohne solche Zeile fehlt er.
5. `Kassieren` ist gesperrt, solange keine Zahlungsart gewählt ist, und wird
   nach Auswahl von `Karte` freigegeben.
6. Nach Auswahl und Klick bekommt `onConfirm` genau `'card'`.
7. Escape ruft `onCancel`. (`fireEvent` auf dem `cancel`-Event des Dialogs,
   weil jsdom kein echtes Escape-Handling für `<dialog>` hat — Kommentar dazu
   in den Test schreiben.)
8. Bei `busy` sind Select, Abbrechen und Kassieren alle gesperrt und der
   Kassieren-Button liest `Wird kassiert…`.
9. `error="Speichern fehlgeschlagen"` wird angezeigt und der Dialog bleibt
   bedienbar (Kassieren nach Auswahl wieder klickbar).

**Commit:** `feat(kassieren): Dialog fragt Betrag und Zahlungsart der Auswahl ab`

---

## Task 3: `List.tsx` verdrahten

**Dateien:** `web/manifest/src/List.tsx`, `web/manifest/src/List.test.tsx`

### Abgeleitete Werte

Neben den vorhandenen `openRows` / `paidRows` (ca. Zeile 390):

```ts
// The bulk action works on the checked rows that are still open. Checked rows
// in the collected table stay untouched — the dialog says so rather than
// passing over them in silence.
const selectedOpenRows = openRows.filter((r) => checkedIds.has(r.id))
const selectedPaidCount = paidRows.filter((r) => checkedIds.has(r.id)).length
```

### State

```ts
const [collectOpen, setCollectOpen] = useState(false)
const [collectError, setCollectError] = useState<string | null>(null)
```

`collecting` gibt es schon und wird mitbenutzt.

### Toolbar-Button

Direkt **vor** dem Lösch-Button (dem `btn-icon` mit `<TrashIcon />`):

```tsx
<button
  type="button"
  className="btn secondary"
  onClick={() => { setCollectError(null); setCollectOpen(true) }}
  disabled={selectedOpenRows.length === 0 || collecting || exporting || deleting}
>
  Kassieren
</button>
```

### Die Schleife

```ts
// Sequential, and each answer folded in with the functional setRows the row
// button uses, so a refresh() landing mid-loop cannot be clobbered by the next
// iteration. On a failure the dialog stays open with the message: the rows
// already collected have left the open table, and `checkedIds` still holds, so
// pressing Kassieren again runs over exactly what is left.
async function handleCollectSelected(method: CollectedVia) {
  setCollecting(true)
  setCollectError(null)
  try {
    for (const row of selectedOpenRows) {
      const fields: ManifestPatch = { paid: true }
      // The payment method is a statement about money that changed hands, so it
      // is only written where money is owed. A fully covered voucher moves none
      // and keeps whatever it already carries.
      if ((row.price ?? 0) > 0) {
        // payment_method says what the jump was paid with; for a voucher row
        // that is already answered, and only the top-up has a till.
        if (row.payment_method === 'voucher') fields.voucher_payment_method = method
        else fields.payment_method = method
      }
      const updated = await patch(row.id, fields)
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    }
  } catch (err) {
    setCollectError(err instanceof Error ? err.message : 'Kassieren fehlgeschlagen')
    return
  } finally {
    setCollecting(false)
  }
  setCollectOpen(false)
  // The rows have moved to the other table; staying checked would arm the
  // delete button on tandems that were just collected.
  setCheckedIds(new Set())
}
```

`CollectedVia` und `ManifestPatch` sind Typ-Importe aus `./api` — zur
bestehenden `import type { DayTables, Registration } from './api'`-Zeile
hinzufügen.

### Rendern

Direkt nach dem `exportWarning`-Block:

```tsx
{collectOpen && (
  <CollectDialog
    rows={selectedOpenRows}
    skippedCount={selectedPaidCount}
    busy={collecting}
    error={collectError}
    onConfirm={(method) => { void handleCollectSelected(method) }}
    onCancel={() => setCollectOpen(false)}
  />
)}
```

### Tests (in `List.test.tsx`, neues `describe('Sammel-Kassieren')`)

`vi.mock('./api', ...)` deckt `patch` schon ab. Zeilen über die vorhandene
`makeRow`-Fabrik bauen, Checkboxen über ihr `aria-label` anhaken — das Muster
ist Vorname, Leerzeichen, Nachname, Leerzeichen, das Wort `auswählen`.

1. `Kassieren` ist ohne Auswahl gesperrt und wird aktiv, sobald eine offene
   Zeile angehakt ist.
2. Ist nur eine schon kassierte Zeile angehakt, bleibt der Button gesperrt.
3. Eine offene und eine kassierte Zeile angehakt: Dialog nennt
   `1 bereits kassierte Zeile bleibt unverändert.`, und nach `Bar` + `Kassieren`
   wird `patch` genau einmal aufgerufen — mit der ID der offenen Zeile.
4. Zeile mit `price: 230, payment_method: 'cash'`: nach Auswahl `Karte` geht
   `{ paid: true, payment_method: 'card' }` raus — die bestehende Zahlungsart
   wird überschrieben.
5. Zeile mit `price: 40, payment_method: 'voucher'`: es geht
   `{ paid: true, voucher_payment_method: 'card' }` raus, **kein**
   `payment_method`.
6. Zeile mit `price: 0, payment_method: 'voucher'`: es geht genau
   `{ paid: true }` raus.
7. Nach erfolgreichem Lauf ist der Dialog weg und die Checkboxen sind leer
   (der Lösch-Button ist wieder gesperrt).
8. Lehnt `patch` beim zweiten Aufruf ab, bleibt der Dialog stehen und zeigt die
   Fehlermeldung; die erste Zeile ist trotzdem in der Kassiert-Tabelle.

**Commit:** `feat(kassieren): Auswahl beider Tabellen sammelt sich in einer Zahlungsart`

---

## Task 4: Styling des Dialogs

**Datei:** `web/manifest/src/index.css`

Neuer Block, einsortiert direkt hinter `.export-warning-actions` (Zeile ~837),
damit die Regeln des List-Screens beisammenbleiben. Vorbilder im selben File:
`.export-warning` für den Panel-Ton, `.btn` / `.btn.primary` / `.btn.secondary`
für die Buttons (die trägt der Dialog schon als Klassen, hier nichts doppeln).

Anforderungen:

- `.collect-dialog` — `border: 1px solid var(--border)`, `border-radius: 8px`,
  `background: var(--panel-bg)`, `color: var(--text)`, `padding: 20px 24px`,
  `min-width: 320px`, `max-width: 420px`. Ohne `color` erbt der Dialog im
  Dark-Mode das Browser-Schwarz und wird unlesbar — das ist der Grund, es zu
  setzen, und gehört als Kommentar dazu.
- `.collect-dialog::backdrop` — abgedunkelt, `rgba(11, 18, 32, 0.5)` (das ist
  `--ink` als rgba; Custom Properties sind in `::backdrop` historisch
  unzuverlässig, deshalb hier ein Literal — Kommentar dazu).
- Überschrift ohne Außenabstand nach oben, Fließtext in derselben Größe wie
  `.export-warning p` (13px, `line-height: 1.45`).
- `.collect-dialog-actions` — `display: flex`, `gap: 8px`,
  `justify-content: flex-end`, `margin-top: 16px`.
- Das `<label>Zahlungsart` stapelt Beschriftung über Select
  (`display: flex; flex-direction: column; gap: 4px`), Select in der gleichen
  Höhe wie die Toolbar-Felder.
- Dark Mode braucht keinen eigenen Media-Query-Block: alle verwendeten Tokens
  werden oben in `@media (prefers-color-scheme: dark)` schon umdefiniert.

Beim Setzen der Klassennamen: sie müssen zu dem passen, was `CollectDialog.tsx`
aus Task 2 tatsächlich rendert. Das Markup ist die Quelle, nicht dieser Plan —
bei Abweichung dem Markup folgen und es hier nicht nachträglich umbenennen.

**Verifikation:** `npm test`, `npm run lint`, `npx tsc -b` grün. `index.css` ist
die einzige geänderte Datei.

**Commit:** `style(kassieren): Dialog bekommt Panel-Rahmen und abgedunkelten Grund`
