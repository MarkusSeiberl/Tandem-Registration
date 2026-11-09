# Tagesabschluss als geführter Dialog

## Problem

Der Tagesabschluss ist heute ein Knopf, der entweder sofort exportiert oder ein
Warn-Panel unter der Toolbar aufklappt (`List.tsx`, `ExportWarning`). Es gibt
keinen Kassensturz, der Betriebsleiter darf leer bleiben, und während des
Exports — Gutscheinliste und Excel dauern in Produktion ein paar Sekunden —
sieht der Operator nur „Tagesabschluss…“ am Knopf. Das Ergebnis steht danach als
eine Textzeile da.

## Lösung

Der Knopf **Tagesabschluss** öffnet immer einen modalen Dialog
(`<dialog>`, `showModal()`), der durch vier Schritte führt und danach exportiert:

1. **Tandems** — offene und zahlungsartlose Tandems direkt erledigen
2. **Kasse** — Kassensturz Bar und Karte
3. **Betriebsleiter** — Pflicht
4. **Abschluss** — Zusammenfassung, dann Export mit Live-Fortschritt, dann Fertig

Referenz-Mockup (freigegeben): Layout mit linker Schrittleiste, siehe
Abschnitt „Gestaltung“.

## Verhalten

### Allgemein

- Jeder Schritt wird immer gezeigt. Ein Schritt ohne Arbeit zeigt „Alles erledigt“
  und wird mit **Weiter** verlassen.
- Navigation: **Weiter** / **Zurück** im Fuß. In der Schrittleiste sind nur
  bereits besuchte Schritte klickbar (zurück frei, vorwärts nur per Weiter).
- **Abbrechen**, Esc und ✕ schließen den Dialog, außer während der Export läuft.
- Alles, was im Dialog getan wurde, bleibt beim Schließen erhalten: kassierte
  Zeilen sind sofort gespeichert, Betriebsleiter über `saveManager()`, Kassensturz
  als Entwurf am Server. Beim nächsten Öffnen ist alles wieder eingesetzt.
- Für jedes Datum verfügbar, nicht nur heute.
- Ist der Tag bereits abgeschlossen (`day_exports`), steht unter dem Titel ein
  Streifen: „Bereits abgeschlossen am 8.11., 18:42 · erneut abschließen
  überschreibt das Blatt. Die Werte von damals sind eingesetzt.“

### 1 Tandems

- Drei Gruppen mit Anzahl und Summe:
  - **Noch nicht kassiert** (`paid_at == null`, Preis > 0)
  - **Kassiert, ohne Zahlungsart** (`paid_at != null`, `collectedVia == null`, Preis > 0)
  - **Gutschein, nichts zu zahlen** (`paid_at == null`, Preis ≤ 0)
- Jede Zeile: Name, darunter Load und Tandemmaster, Gutschein-Marke, Preis, und
  **Bar** / **Karte** — bzw. **Kassieren** in der dritten Gruppe.
- Bar/Karte schreibt mit derselben Regel wie `runCollect()`: `paid: true` und
  `payment_method` — bei Gutschein-Zeilen `voucher_payment_method`. Kassieren
  schreibt nur `paid: true`.
- Eine erledigte Zeile gleitet aus der Liste. Ein Fehler bleibt an der Zeile stehen.
- Die Zeilen kommen live aus `List` (`rows`), ein anderes Tablet kann sie also
  verändern, während der Schritt offen ist.
- Offene Zeilen dürfen stehen bleiben: Weiter geht immer. Der Schritt bekommt
  dann in der Leiste die Warn-Markierung statt ✓ und den Status „N bleibt/bleiben offen“.

### 2 Kasse

- Tabelle mit Zeilen *Erwartet / Gezählt / Differenz* und Spalten **Bar** und **Karte**.
- *Erwartet* = Summe der Preise der kassierten Zeilen je `collectedVia` —
  dieselbe Rechnung wie „Summe Bar“ / „Summe Karte“ im Blatt.
- *Gezählt* ist optional; leer heißt „nicht gezählt“. Eingabe im deutschen
  Format (`1.300,00` oder `1300`), ≥ 0, höchstens 2 Nachkommastellen.
- *Differenz* = Gezählt − Erwartet: 0 → „stimmt“ (grün), sonst „+x € zu viel“ /
  „−x € zu wenig“ (ember). Nicht gezählt → keine Differenz.
- Sobald eine Kasse abweicht, erscheint **Begründung** (eine für beide Kassen)
  und ist Pflicht für Weiter.
- Der Entwurf wird beim Verlassen eines Feldes, beim Verlassen des Schritts und
  beim Schließen des Dialogs gespeichert.

### 3 Betriebsleiter

- Ein Feld, derselbe `manager`-State wie das Feld in der Toolbar (das bleibt).
- Pflicht: Weiter ist gesperrt, solange es leer ist; daneben „Name fehlt“.
- Weiter speichert über `saveManager()`; schlägt das fehl, bleibt der Schritt
  stehen und zeigt den Fehler.

### 4 Abschluss

- Zusammenfassung: Betriebsleiter, Tandems (gesamt, kassiert, offen),
  Bar und Karte je gezählt / erwartet / Differenz, Begründung.
- Was offen bleibt, steht in einem Ember-Kasten mit Link zurück zum Schritt.
- Knopf **Tagesabschluss durchführen**.

### Export läuft

- Leiste, Fuß, ✕ und Esc sind gesperrt.
- Drei Phasen:
  1. Kassensturz gespeichert — der letzte `PUT` des Entwurfs durch den Client
  2. Gutscheinliste — „n von m“ mit Fortschrittsbalken, aus Server-Events
  3. Excel-Blatt
- „Bitte warten, nicht schließen. Das dauert ein paar Sekunden.“

### Fertig / Fehler

- **Nur nach erfolgreicher Antwort** des Exports: Fertig-Ansicht mit Siegel,
  „Tag abgeschlossen“, Datum und Anzahl, Dateipfad, Gutscheinliste
  (eingetragen / noch offen / ungültig), Kassensturz-Ergebnis, offen gebliebene
  Tandems. Einziger Knopf **Schließen**.
- **Fehler**: zurück zur Zusammenfassung mit rotem Kasten (Meldung des Servers,
  „Der Tag ist noch nicht abgeschlossen.“), Knopf **Erneut versuchen**, Status in
  der Leiste „Fehlgeschlagen“ in Rot. Der Tag wird nicht als abgeschlossen
  markiert (wie heute).

## Daten und API

### Tabelle

```sql
CREATE TABLE IF NOT EXISTS day_close (
  jump_date    TEXT PRIMARY KEY,
  counted_cash REAL,            -- NULL = nicht gezählt
  counted_card REAL,            -- NULL = nicht gezählt
  note         TEXT NOT NULL DEFAULT '',
  updated_at   TEXT NOT NULL
);
```

### Routen (`src/server/routes/dayClose.ts`)

- `GET /api/day-close/:date` →
  `{ countedCash: number|null, countedCard: number|null, note: string, exportedAt: string|null }`.
  Ohne Eintrag: alles `null` bzw. `''`. `exportedAt` aus `day_exports`.
- `PUT /api/day-close/:date` mit `{ countedCash, countedCard, note }` →
  dieselbe Form zurück. 400 bei ungültigem Datum, Betrag < 0, mehr als
  2 Nachkommastellen, nicht endlicher Zahl, Notiz > 500 Zeichen.

### Export (`POST /api/export?date=…&run=…`)

- `run` ist eine vom Client erzeugte Kennung (optional; ohne sie gibt es keine
  Events).
- **Sperre je Datum**: Läuft für das Datum schon ein Export → `409
  { error: 'Tagesabschluss läuft bereits' }`. Freigabe in `finally`.
- **Prüfungen vor dem Schreiben** (Sicherheitsnetz, der Dialog verhindert beides):
  - leerer Betriebsleiter → `400 { error: 'Betriebsleiter fehlt' }`
  - eine gezählte Kasse weicht ab und `note` ist leer →
    `400 { error: 'Begründung für die Kassendifferenz fehlt' }`
- **Fortschritt** über `SseHub.broadcast('export-progress', …)`:
  - `{ run, date, phase: 'vouchers', done, total }` — einmal mit `done: 0` und
    nach jeder Gutschein-Zeile
  - `{ run, date, phase: 'sheet' }` — vor dem Schreiben des Blatts
  - `registerExportRoutes` bekommt dafür `sse`.
- Die HTTP-Antwort bleibt das maßgebliche Erfolgssignal; ihre Form bleibt gleich.

### Blatt (`excel.ts`)

Eigener Block **Kassensturz** unter den Summen:

```
Kassensturz
Gezählt Bar               1.300,00 €
Differenz Bar                +5,00 €
Gezählt Karte               548,00 €
Differenz Karte               0,00 €
Begründung     Trinkgeld in der Kasse
```

Nicht gezählte Kasse: `Gezählt Bar  nicht gezählt`, keine Differenzzeile.
Begründung nur, wenn nicht leer. Ohne `day_close`-Eintrag steht der Block mit
„nicht gezählt“ für beide Kassen da.

### Client

- `api.ts`: `dayClose(date)`, `saveDayClose(date, draft)`,
  `exportDay(date, runId?)`.
- `useEvents.ts`: `useExportProgress(runId, onProgress)` — eigener EventSource,
  nur offen, solange `runId` gesetzt ist; filtert auf `run`.

## Komponenten

`web/manifest/src/dayClose/`:

| Datei | Aufgabe |
| --- | --- |
| `DayCloseDialog.tsx` | Dialog-Hülle, Kopf, Abgeschlossen-Streifen, Schrittleiste, Fuß, Schritt-State, Sperre, Entwurf laden/speichern, Export-Ablauf |
| `StepTandems.tsx` | Schritt 1 |
| `StepCash.tsx` | Schritt 2 |
| `StepManager.tsx` | Schritt 3 |
| `StepSummary.tsx` | Schritt 4 inkl. Fehlerkasten |
| `ExportRunning.tsx` | Phasen |
| `ExportDone.tsx` | Fertig |
| `cashMath.ts` | reine Funktionen: Gruppen der Zeilen, erwartete Summen, Differenz, Eingabe parsen/formatieren, „braucht Begründung“ |

`List.tsx` behält `rows`, `manager`, `saveManager()`, `patch`. Es übergibt dem
Dialog die Zeilen, die Tandemmaster-Namen, den Manager-State und eine
`settleRow(row, method | null)`-Funktion. **Entfernt** werden: Warn-Panel,
`ExportWarning`, `warningCounts`, `warningExplanation`, `computeExportWarning`,
`handleCollectAllAndExport`, `runExport`, `exportMessage`, die `needs-entry`-
Markierung am Toolbar-Feld und die zugehörigen CSS-Regeln (`.export-warning`,
`.export-checklist`, `.export-why`, `.export-warning-actions`,
`.manager-field.needs-entry`).

## Gestaltung

Bleibt in der Welt des Manifests (Operate-Oberfläche): vorhandene Tokens aus
`index.css`, keine neuen Farben oder Schriften. Grün = erledigt/los, Ember =
hinsehen, Rot nur für Fehler. Beträge in `.numeral`.

- Dialog ca. 880 × 680 px (`min(680px, 100vh − 96px)`), Radius 10 px,
  weicher Schatten, Hintergrund abgedunkelt wie `.collect-dialog::backdrop`.
- Kopf: „Tagesabschluss“ + Wochentag/Datum (ruhig), ✕ als Icon-Knopf
  (`CloseIcon`).
- Schrittleiste 248 px auf `--bg`: Marker 30 px (offen: Nummer im grauen Ring;
  aktuell: grüner Ring, helle Fläche, 3 px grüne Innenkante; erledigt: grün
  gefüllt mit ✓; Warnung: Ember-Ring mit „!“), Name, Statuszeile darunter.
  Die Verbindungslinie wird grün, je weiter man kommt. Icons als SVG im Stil
  von `CheckIcon`, keine Unicode-Zeichen.
- Inhalt: Titel 22 px, Einleitung 14 px ruhig, Inhalte als Linien-Listen
  (keine Karten).
- Bewegung: genau zwei Momente — die erledigte Zeile gleitet hinaus, das Siegel
  auf Fertig springt einmal auf; Spinner in der laufenden Phase.
  `prefers-reduced-motion` schaltet beides ab.
- Hell und dunkel über die vorhandenen Tokens.

## Fehlerfälle

| Fall | Verhalten |
| --- | --- |
| Entwurf laden schlägt fehl | Felder leer, Hinweis im Schritt Kasse; Dialog bleibt nutzbar |
| Entwurf speichern schlägt fehl | Meldung im Schritt; Export startet nicht, solange der letzte `PUT` fehlschlägt |
| Zeile kassieren schlägt fehl | Fehler an der Zeile, Zeile bleibt |
| Betriebsleiter speichern schlägt fehl | Schritt 3 bleibt, Meldung |
| Export 409 | Zusammenfassung mit „Tagesabschluss läuft bereits (anderer Rechner)“ |
| Export 400 / 500 / Netzwerk | Zusammenfassung mit Servermeldung, Erneut versuchen |
| SSE-Events kommen nicht an | Phasen bleiben stehen; die HTTP-Antwort entscheidet trotzdem über Fertig |

## Tests

- Server: `tests/dayClose.test.ts` (GET/PUT, Validierung, `exportedAt`),
  `tests/export.test.ts` (Block im Blatt, „nicht gezählt“, 400 ohne BL, 400 ohne
  Begründung, 409 bei laufendem Export, Events mit `run`), `tests/excel.test.ts`
  (Layout des Blocks).
- Client: `cashMath.test.ts`, `DayCloseDialog.test.tsx` (Zustände je Schritt,
  Weiter-Regeln, Leiste nur zurück, Sperre während des Exports, Fertig nur nach
  Erfolg, Fehler → Zusammenfassung, Entwurf wird geladen), `List.test.tsx`
  (alte Panel-Tests ersetzt durch „Knopf öffnet Dialog“).
- E2E: `tests/e2e/flow.spec.ts` geht durch den Dialog.

## Nicht Teil davon

- Auszahlungen im Dialog prüfen.
- Kassensturz in Statistik oder Übersicht anzeigen.
- Wechselgeld/Anfangsbestand der Kasse.
