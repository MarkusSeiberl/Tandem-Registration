# Umsetzungsplan: Betriebsleiter vor dem Tagesabschluss

Design: `docs/superpowers/specs/2026-09-13-betriebsleiter-vor-tagesabschluss-design.md`

Alle Arbeit liegt in `web/manifest/`. Tests laufen dort mit `npm test`
(vitest run), Typen mit `npx tsc -b`. Nur zwei Dateien werden angefasst:
`web/manifest/src/List.tsx` und `web/manifest/src/List.test.tsx`.

## Global Constraints

Diese gelten für jeden Task und sind verbindlich:

1. **Sprache.** Sichtbarer Text ist Deutsch, exakt in der Schreibweise, die
   dieser Plan vorgibt (typografische Anführungszeichen „…" wie im übrigen
   `List.tsx`). Code-Kommentare sind Englisch, im erklärenden Ton, den
   `List.tsx` schon hat: sie sagen *warum*, nicht *was*.
2. **Kein Server-Change.** `src/server/` wird nicht angefasst. Der leere
   Betriebsleiter bleibt serverseitig erlaubt.
3. **Ein State für beide Felder.** Es gibt genau ein `manager`-State in
   `List.tsx`. Kein zweites State, kein Ref, keine Kopie für das Panel.
4. **Kein neues Speichern.** Geschrieben wird ausschließlich über das
   vorhandene `saveManager()`, das `runExport()` bereits als Erstes aufruft.
   Das Panel bekommt keinen eigenen `onBlur`-Save und keinen eigenen
   `saveDayManager()`-Aufruf.
5. **Schnappschuss vs. live** (aus dem Design, exakt):
   - ob das Feld im Panel steht → `exportWarning.noManager` (Schnappschuss)
   - Warnabsatz und Button-Beschriftung → `manager.trim() === ''` (live)
6. **Die vorhandenen Warntexte** `warningCounts()` und `warningExplanation()`
   bleiben unverändert. Der Betriebsleiter bekommt seinen eigenen Absatz.
7. **Keine neuen Abhängigkeiten, keine neuen CSS-Farb-Literale.** Nur
   vorhandene Klassen und Custom Properties aus `index.css`.
8. **TDD.** Test zuerst, rot sehen, dann implementieren. Jeder Task endet mit
   grünem `npm test` und sauberem `npx tsc -b` in `web/manifest/`.
9. **Sauberer Baum.** Jeder Task committet genau die beiden genannten Dateien.

---

## Task 1: Der leere Betriebsleiter öffnet das Warn-Panel

**Dateien:** `web/manifest/src/List.tsx`, `web/manifest/src/List.test.tsx`

### Was

`ExportWarning` bekommt ein Feld:

```ts
  /**
   * Whether the day had no Betriebsleiter when the button was pressed. Only
   * decides that the panel carries the name field — the warning sentence and
   * the button's label read the live value, because the operator fixes this
   * one inside the panel.
   */
  noManager: boolean
```

`computeExportWarning(source)` zählt nur Zeilen und kennt den Namen nicht. Es
bekommt den fehlenden Betriebsleiter als zweites Argument:

```ts
function computeExportWarning(source: Registration[], noManager: boolean): ExportWarning
```

Beide vorhandenen Aufrufstellen in `handleCollectAllAndExport()` übergeben
`manager.trim() === ''`.

`handleExport()` öffnet das Panel jetzt auch wegen des Namens:

```ts
  function handleExport() {
    const noManager = manager.trim() === ''
    if (openRows.length === 0 && noPaymentRows.length === 0 && !noManager) {
      void runExport()
      return
    }
    setExportMessage(null)
    setExportWarning({
      open: openRows.length,
      openVoucher: openVoucherRows.length,
      noPayment: noPaymentRows.length,
      noPaymentOpen: noPaymentOpenRows.length,
      noManager,
    })
  }
```

Im Panel, **über** den beiden vorhandenen `<p>`-Absätzen, der neue Absatz — er
hängt am **live** gelesenen Namen, nicht am Schnappschuss:

```tsx
          {manager.trim() === '' && (
            <p>Kein Betriebsleiter eingetragen. Die BL-Zeile im Blatt bliebe leer.</p>
          )}
```

Die beiden vorhandenen Absätze `warningCounts()` / `warningExplanation()` sind
auf einem sauberen Tag leer und würden zwei leere Zeilen in das Panel setzen.
Sie rendern deshalb nur noch, wenn sie etwas zu sagen haben — die Bedingung ist
der Text selbst, damit nie eine Zählung und ihre Erklärung auseinanderfallen:

```tsx
          {warningCounts(exportWarning) && <p>{warningCounts(exportWarning)}</p>}
```
(sinngemäß auch für `warningExplanation`; die doppelte Auswertung darf in eine
lokale Konstante über dem `return` des Panels gezogen werden.)

Der Export-Button im Panel wechselt seine Beschriftung:

```tsx
              {manager.trim() === '' ? 'Trotzdem exportieren' : 'Exportieren'}
```

Sonst bleibt er, wie er ist (`btn secondary small`, `onClick={() => { void runExport() }}`,
`disabled={collecting || exporting}`).

### Tests

Im Block `Export-Warnung` von `List.test.tsx`. Der `beforeEach` dort mockt
`api.dayManager` mit `{ name: '' }` — bestehende Tests, die einen Sofort-Export
oder die Abwesenheit des BL-Absatzes behaupten, setzen sich den Namen selbst
(`vi.mocked(api.dayManager).mockResolvedValue({ name: 'Max Muster' })` vor
`renderList`) und warten wie üblich mit `await screen.findByText(...)` auf die
geladene Zeile.

Neu:

1. **Sauberer Tag, leerer Betriebsleiter → Panel statt Export.** Eine
   kassierte Zeile mit Zahlungsart, `dayManager` leer. Nach dem Druck auf
   `Tagesabschluss` steht „Kein Betriebsleiter eingetragen. Die BL-Zeile im
   Blatt bliebe leer." auf der Seite und `api.exportDay` wurde nicht gerufen.
2. **Sauberer Tag mit Betriebsleiter → exportiert sofort.** Gleiche Zeile,
   `dayManager` gibt `{ name: 'Max Muster' }`. `Export erstellt` erscheint,
   kein BL-Absatz.
3. **Beschriftung.** Panel offen mit leerem Namen → Button heißt
   `Trotzdem exportieren`. Panel offen, weil Zeilen offen sind, Name gesetzt →
   Button heißt `Exportieren`.
4. **Override bleibt.** Aus dem wegen des leeren Namens geöffneten Panel ruft
   `Trotzdem exportieren` `api.exportDay` auf.

Der bestehende Test „exports straight away when the day is collected and paid
for" und jeder andere, der auf einem sauberen Tag einen Sofort-Export erwartet,
bekommt den Namen aus Punkt 2. Kein bestehender Test wird gelöscht oder in
seiner Aussage verändert.

**Verifikation:** `npm test` grün, `npx tsc -b` sauber (beides in `web/manifest/`).

**Commit:** `feat(tagesabschluss): Fehlender Betriebsleiter oeffnet die Warnung`

---

## Task 2: Der Name lässt sich im Panel eintragen

**Dateien:** `web/manifest/src/List.tsx`, `web/manifest/src/List.test.tsx`

### Was

Das Panel bekommt das Feld, sobald es wegen des Namens aufging — gebunden an
dasselbe `manager`-State wie die Toolbar, damit der getippte Name sofort oben
steht und `saveManager()` ihn beim Export mitnimmt:

```tsx
          {exportWarning.noManager && (
            <label className="manager-field">
              Betriebsleiter
              <input
                type="text"
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                disabled={collecting || exporting}
              />
            </label>
          )}
```

Platz: zwischen den Warnabsätzen und `<div className="export-warning-actions">`.
Die Bedingung ist hier der **Schnappschuss** `exportWarning.noManager` — das
Feld darf nicht unter dem Finger verschwinden, sobald der erste Buchstabe
steht.

`aria-label` ist nicht nötig: das `<label>` trägt den Text, wie in der Toolbar.
Weil damit zwei Felder gleichen Namens im Dokument stehen, greifen die Tests
auf sie mit `within(...)` zu — Panel über den Container der Warnung, Toolbar
über `screen.getByRole('toolbar')` gibt es nicht, also über
`document.querySelector('.list-toolbar')` bzw. `getAllByLabelText('Betriebsleiter')`
mit Index. Welche Variante — Entscheidung des Implementers, solange der Test
eindeutig benennt, welches der beiden Felder er meint.

Kein weiterer Code: `runExport()` ruft `saveManager()` bereits als Erstes auf,
und `handleCollectAllAndExport()` endet in `runExport()`.

### Tests

Im selben Block, neu:

1. **Getippter Name steht auch in der Toolbar.** Panel wegen leerem Namen
   geöffnet, `Max Muster` in das Panel-Feld getippt → das Toolbar-Feld trägt
   denselben Wert.
2. **Export aus dem Panel speichert den Namen.** Nach dem Tippen Druck auf
   `Exportieren` → `api.saveDayManager` wurde mit dem Datum und `Max Muster`
   gerufen, danach `api.exportDay`.
3. **Kein Feld ohne Grund.** Panel, das nur wegen offener Tandems aufging
   (Name gesetzt) → im Panel steht kein zweites Betriebsleiter-Feld.
4. **Das Feld bleibt stehen, der Warnsatz geht.** Nach dem Tippen ist der
   Absatz „Kein Betriebsleiter eingetragen…" weg, das Feld im Panel aber noch
   da (das ist der Unterschied zwischen Schnappschuss und Live-Wert).

**Verifikation:** `npm test` grün, `npx tsc -b` sauber (beides in `web/manifest/`).

**Commit:** `feat(tagesabschluss): Betriebsleiter laesst sich in der Warnung nachtragen`
