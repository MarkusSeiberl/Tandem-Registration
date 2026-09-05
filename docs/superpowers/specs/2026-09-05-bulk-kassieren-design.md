# Mehrere Tandems auf einmal kassieren

## Problem

Kassiert wird heute Zeile für Zeile: pro Tandem ein Klick auf „✓ Kassiert“, und
die Zahlungsart muss vorher im Detail-Screen gesetzt worden sein. Am Landeplatz
zahlt aber oft eine Gruppe zusammen — vier Sprünge, einmal Karte. Für diesen
Fall gibt es nur „Alle kassieren und exportieren“, und das nimmt den ganzen Tag
und schreibt gar keine Zahlungsart.

Dasselbe Loch hat der Zeilen-Button auch für sich allein: er stempelt `paid`
und sonst nichts, also landet ein Tandem, dessen Zahlungsart nie im Detail
gesetzt wurde, kassiert und trotzdem unter „Summe ohne Zahlungsart“ im Export.

## Lösung

Die Checkboxen, die es in beiden Tabellen schon gibt, bekommen eine zweite
Aktion neben dem Löschen: „Kassieren“. Ein Dialog nennt den offenen Betrag der
Auswahl und fragt nach genau einer Zahlungsart, die dann auf alle ausgewählten
offenen Zeilen geschrieben wird.

Der Zeilen-Button „✓ Kassiert“ macht ab jetzt dasselbe für genau ein Tandem: er
öffnet denselben Dialog mit dieser einen Zeile. Eine Aktion, eine Schreibregel,
zwei Mengen — die Zahlungsart wird überall gefragt statt geraten.

## Auswahl

`checkedIds` ist ein Set über beide Tabellen. Die Aktion arbeitet nur auf den
offenen Zeilen daraus:

```
selectedOpenRows  = openRows.filter(r => checkedIds.has(r.id))
selectedPaidCount = paidRows.filter(r => checkedIds.has(r.id)).length
```

Angehakte, schon kassierte Zeilen werden nicht angefasst — aber der Dialog sagt
es dazu, statt sie stumm zu übergehen.

Der Toolbar-Button steht neben dem Löschen-Button und ist gesperrt, solange
`selectedOpenRows` leer ist oder eine andere Massenaktion läuft
(`collecting` / `exporting` / `deleting`).

## Der Zeilen-Button

Welche Menge der offene Dialog kassiert, sagt ein einziger Zustand in `List`:

```ts
const [collectTarget, setCollectTarget] = useState<'selection' | number | null>(null)

const collectRows = collectTarget === 'selection'
  ? selectedOpenRows
  : openRows.filter(r => r.id === collectTarget)
const collectSkippedCount = collectTarget === 'selection' ? selectedPaidCount : 0
```

`null` heißt geschlossen, `'selection'` ist der Toolbar-Weg, eine Id der
Zeilen-Weg. Beide Wege laufen danach durch dieselbe Schleife
(`handleCollectSelected`), also gelten Schreibregel, Fehlerverhalten und
Reihenfolge unverändert für eine Zeile wie für zwölf.

Zwei Unterschiede, und beide folgen daraus, dass ein Zeilen-Button nichts über
die Auswahl aussagt:

- `skippedCount` ist 0. Der Dialog erwähnt angehakte kassierte Zeilen nicht, weil
  er sie gar nicht kassieren wollte.
- Nach dem Lauf wird nur diese eine Id aus `checkedIds` entfernt statt der
  ganzen Auswahl. Wer eine Gruppe zusammengeklickt hat und zwischendurch einen
  Einzelnen kassiert, findet den Rest der Gruppe noch angehakt vor.

`collectRows` wird aus `openRows` gelesen und nicht als Schnappschuss gehalten:
kassiert ein anderes Tablet die Zeile, während der Dialog offen steht, fällt sie
aus dem Lauf, und der leere Lauf bricht oben ab, statt Erfolg für nichts zu
melden.

Beide Zeilen-Aktionen (`✓ Kassiert` und `↩`) sind gesperrt, solange eine
Massenaktion läuft — sie würden ihr in die Schleife fahren.

## Zeilenzahl in der Toolbar

Die Toolbar zeigte bis hierher `N Einträge` für den ganzen Tag. Die Zahl steht
in beiden Tabellen-Captions schon genauer da (`Offen (n)` / `Kassiert (n)`), und
eine dritte Zahl daneben lädt nur dazu ein, die beiden von Hand zu addieren. Sie
fällt weg; `margin-left: auto` wandert von `.list-count` auf `.list-total-open`,
damit die Beträge weiter rechts stehen.

## Schreibregel

Die Zahlungsart gilt nur für Zeilen mit offenem Betrag. Pro Zeile:

```ts
const fields: ManifestPatch = { paid: true }
if ((row.price ?? 0) > 0) {
  if (row.payment_method === 'voucher') fields.voucher_payment_method = method
  else fields.payment_method = method
}
await patch(row.id, fields)
```

| Zeile | geschrieben |
|---|---|
| Bar/Karte/keine Methode, Betrag > 0 | `payment_method` (überschreibt) + `paid` |
| Gutschein, Restbetrag > 0 | `voucher_payment_method` + `paid` |
| Betrag 0 (voll gedeckter Gutschein) | nur `paid` |

Zwei Entscheidungen dahinter:

Eine **bestehende Zahlungsart wird überschrieben**. Wer den Dialog bedient, hat
das Geld gerade in der Hand und weiß es besser als ein Feld, das beim
Registrieren einmal angeklickt wurde. So bleibt die Regel außerdem ein Satz:
offener Betrag > 0 heißt, die Zahlungsart wird geschrieben.

Eine **Gutschein-Zeile bleibt Gutschein**. `payment_method` sagt, womit der
Sprung bezahlt wurde; `voucher_payment_method` sagt, in welche Kasse die
Differenz gefallen ist. Nur letzteres kann eine Massenaktion wissen. Ein voll
gedeckter Gutschein bewegt kein Geld und bekommt deshalb gar keine Kasse
zugeschrieben — das ist dieselbe Unterscheidung, die `collectedVia()` und die
„Kassiert Bar/Karte“-Summen schon machen.

Die Schleife läuft sequenziell und faltet jede Antwort mit
`setRows(prev => prev.map(...))` ein, damit ein `refresh()` mitten im Lauf nicht
von der nächsten Iteration überschrieben wird — gleiches Muster wie
`handleCollectAllAndExport`.

## Dialog

Eigene Datei `web/manifest/src/CollectDialog.tsx`, reine Präsentation, kennt
die API nicht:

```ts
interface CollectDialogProps {
  rows: Registration[]      // die offenen ausgewählten
  skippedCount: number      // angehakte, aber schon kassierte
  busy: boolean
  error: string | null
  onConfirm: (method: CollectedVia) => void
  onCancel: () => void
}
```

Inhalt:

- Überschrift `3 Tandems kassieren`
- `Offener Betrag: 690 €` — Summe über `price ?? 0`
- bei `skippedCount > 0`: `2 bereits kassierte Zeilen bleiben unverändert.`
- bei Zeilen mit Betrag 0: `1 Tandem ohne Restbetrag behält seine Zahlungsart.`
  Die Regel wird gezeigt, nicht stumm angewandt.
- Select `Zahlungsart` mit `COLLECTED_VIA` (Bar/Karte), **ohne Vorauswahl**:
  Platzhalter `– bitte wählen –`, Kassieren bleibt gesperrt bis gewählt. Die
  Zahlungsart ist die Aussage, die der Dialog treffen soll; eine Vorbelegung
  würde sie raten.
- Fehlerzeile, wenn `error` gesetzt ist
- `Abbrechen` / `Kassieren`

Ein echtes `<dialog>`: `useEffect` ruft beim Mount `showModal()`, das
`cancel`-Event (Escape) ruft `onCancel`. Während `busy` sind Select und beide
Buttons gesperrt, damit Escape nicht mitten in die Schleife fährt.

`List.tsx` hält den Zustand (`collectOpen`, `collectError`, `collecting`) und
die Schleife.

## Fehler mitten im Lauf

Die Schleife bricht ab, der Dialog **bleibt offen** und zeigt den Fehler.
Bereits gepatchte Zeilen stehen schon in `rows` und sind aus der Offen-Tabelle
verschwunden; `checkedIds` bleibt, ein zweiter Klick auf Kassieren läuft also
nur noch über die verbliebenen offenen Zeilen.

Der Fehler geht bewusst nicht durch `setError`: ein SSE-getriggertes
`refresh()` räumt `error` weg und würde die Meldung spurlos löschen — derselbe
Grund, aus dem der Bulk-Export-Pfad `exportMessage` benutzt.

Nach einem erfolgreichen Lauf schließt der Dialog und `checkedIds` wird geleert.
Die Zeilen sind in die andere Tabelle gewandert; angehakt zu bleiben würde den
Löschen-Button auf frisch kassierte Zeilen scharf stellen.

## Testumgebung

jsdom 29.1.1 kennt `HTMLDialogElement` und dessen `open`-Property, aber weder
`showModal` noch `close`. `setupTests.ts` bekommt daher einen Stub neben dem
vorhandenen `EventSource`-Stub:

```ts
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.open = true }
  HTMLDialogElement.prototype.close = function () { this.open = false }
}
```

## Tests

`CollectDialog.test.tsx`

- Betragssumme über die übergebenen Zeilen
- Zusatzzeile für übersprungene kassierte Zeilen, nur wenn `skippedCount > 0`
- Zusatzzeile für Zeilen ohne Restbetrag, nur wenn es sie gibt
- Kassieren gesperrt, solange keine Zahlungsart gewählt ist
- `onConfirm` bekommt die gewählte Methode
- Escape ruft `onCancel`
- bei `busy` sind Select und beide Buttons gesperrt

`List.test.tsx`

- Button gesperrt ohne Auswahl, aktiv sobald eine offene Zeile angehakt ist
- Auswahl über beide Tabellen patcht nur die offenen Zeilen
- Gutschein-Zeile mit Restbetrag bekommt `voucher_payment_method`, nicht
  `payment_method`
- Zeile mit Betrag 0 bekommt nur `paid`
- Fehler mitten im Lauf lässt den Dialog stehen und zeigt ihn an

Für den Zeilen-Weg (`describe('Zeilen-Kassieren')`)

- „✓ Kassiert“ öffnet den Dialog mit `1 Tandem kassieren` und patcht erst nach
  der gewählten Zahlungsart
- eine angehakte Gruppe bleibt angehakt, nur die kassierte Zeile fällt heraus
- angehakte kassierte Zeilen werden nicht erwähnt
- Gutschein-Zeile bekommt auch hier `voucher_payment_method`
- ein Fehlschlag lässt den Dialog mit der Meldung stehen
- `↩` fragt nach wie vor nichts und patcht direkt `{ paid: false }`
- die Toolbar zeigt keine Tageszahl `N Einträge` mehr

`flow.spec.ts` (e2e) wählt im Dialog Karte, damit die Zeile mit der Zahlungsart
im Export ankommt, mit der sie bezahlt wurde.
