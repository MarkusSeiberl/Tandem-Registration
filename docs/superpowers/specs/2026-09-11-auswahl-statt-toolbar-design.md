# Auswahl-Aktionen aus der Tages-Toolbar lösen

## Problem

Die Toolbar des Manifests trägt heute sechs Bedienelemente in einer Reihe, in
identischem Grau (`btn secondary`), mit gleicher Höhe und gleichem Abstand:

```
Datum [..] [Heute]  Betriebsleiter [__]  [Tagesabschluss] [Kassieren] [🗑]   Offen: … / Bar: … / Karte: …
```

Sie gehören aber zwei verschiedenen Reichweiten:

| Reichweite | Elemente | wirkt auf |
| --- | --- | --- |
| Tag | Datum, Heute, Betriebsleiter, Tagesabschluss | den ganzen angezeigten Tag |
| Auswahl | Kassieren, Löschen | genau die angehakten Zeilen |

Nichts am Aussehen sagt das. Der einzige Unterschied ist der `disabled`-Zustand:
`Kassieren` und `🗑` sind gesperrt, solange nichts angehakt ist. Das ist ein
schwaches Signal — ein gesperrter Button sieht aus wie ein Button, der gerade
nicht darf, nicht wie einer, der eine Auswahl braucht, die es noch nicht gibt.
Und er steht räumlich bei der Datumsauswahl statt bei den Zeilen, auf die er
wirkt.

## Lösung

Zwei Reichweiten, zwei visuelle Sprachen.

Die Toolbar behält nur noch den Tag: Datum, Heute, Betriebsleiter,
Tagesabschluss, Summen. Sie bleibt ein neutraler Kopf ohne eigene Fläche.

`Kassieren` und `Löschen` ziehen in eine eigene **Auswahl-Leiste**, die zwischen
den Bannern und der ersten Tabelle sitzt, am Viewport klebt und nur Inhalt hat,
solange eine Auswahl existiert:

```
┌ Tag ──────────────────────────────────────────────┐
│ Datum [2026-09-11] [Heute]  Betriebsleiter [___]  │
│ [Tagesabschluss]        Offen: 1.240 €            │
│                         Bar: 310 €  Karte: 180 €  │
└───────────────────────────────────────────────────┘
┃ 5 ausgewählt · 3 offen
┃ [Kassieren (3)]  [🗑 Löschen (5)]   [Auswahl leeren]

  Offen (7)
  ┌──┬──────────┬─────┬───────┬──────┐
  │☑ │ Name     │ Alt │ kg    │ …    │
```

## Reichweite der Leiste

`checkedIds` ist ein Set über **beide** Tabellen, und die beiden Aktionen haben
verschiedene Mengen:

- `Kassieren` wirkt auf `selectedOpenRows` — nur die offenen der angehakten.
- `Löschen` wirkt auf `checkedIds` — alle angehakten, offen wie kassiert.

Eine Leiste für beide Tabellen, nicht eine pro Tabelle. Sie nennt beide Zahlen:

```
5 ausgewählt · 3 offen      → [Kassieren (3)] [🗑 Löschen (5)]
2 ausgewählt · keine offen  →                 [🗑 Löschen (2)]
```

Die Zahlen stehen **auf** den Buttons, nicht nur in der Zusammenfassung: sonst
bleibt es dem Leser überlassen, welche der beiden Zahlen zu welchem Button
gehört.

`Kassieren` wird **nicht gesperrt, sondern gar nicht gerendert**, wenn keine
offene Zeile angehakt ist. Genau dieser gesperrte Button war das schwache
Signal, das hier abgeschafft wird.

## Visuelle Sprache

| | Tag | Auswahl |
| --- | --- | --- |
| Fläche | keine, direkt auf `--bg` | `--panel-bg`, 1px `--border`, 3px `--ember` links |
| Buttons | `btn secondary` (wie heute) | `Kassieren` = `btn primary`, `Löschen` = `btn danger btn-icon` mit Text |
| Anwesenheit | immer | Inhalt nur bei Auswahl |

Der Ember-Rahmen ist auf diesem Screen schon die Sprache für „hier ist etwas zum
Drücken“ (`.day-outdated`, `.export-warning`), und `--ember` ist die Farbe von
`list-total-open` — die Leiste erbt damit vorhandene Bedeutung statt eine neue
zu erfinden.

`Kassieren` steigt von `secondary` auf `primary` (gefüllt, Akzentgrün). Das ist
die zweite Hälfte des Signals: sobald Zeilen angehakt sind, **ist** es der
nächste Schritt — in einer Reihe von sechs gleichen grauen Buttons konnte es das
nie aussehen.

## Sticky-Mechanik

```css
.selection-bar-active { position: sticky; top: 0; z-index: 3; }
```

Die Spaltenköpfe brauchen **keinen** Versatz, obwohl `.manifest-table th` schon
`position: sticky; top: 0` trägt: `.manifest-table` hat `overflow: hidden`
(es beschneidet die Zeilen auf die runden Ecken), und damit ist die Tabelle
selbst der Scrollport ihrer Zellen — eine Box, die nie scrollt. Die Kopfzeile
klebt also an gar nichts und kann von der Leiste nicht verdeckt werden.

Ein Versatz wäre sogar schädlich, und das ist zuerst so gebaut worden: ein
`top: 56px` auf `th` wird gegen die Tabellenoberkante gerechnet, nicht gegen den
Viewport, und schiebt die Kopfzeile 56px **in die Tabelle hinein** — gemessen
`tableRect 180 / thRect 236`, sichtbar als leeres Band über der ersten Zeile.

## Kein Layout-Sprung

Die Leiste liegt im Fluss, also würde das erste Anhaken die Tabellen 56px nach
unten schieben — auf dem Tablet wandert damit die *nächste* Checkbox unter dem
Finger weg, genau während mehrere Häkchen gesetzt werden.

Deshalb ist die Höhe **immer reserviert**: ohne Auswahl steht ein leerer
Platzhalter derselben Höhe. Nur der Inhalt der Leiste erscheint und verschwindet,
die Tabellen bewegen sich nie. Kostet 56px auf einer unberührten Liste.

Der Platzhalter ist dieselbe Box wie die Leiste, nur leer. Sie hält immer ihre
Höhe (56px), **klebt aber nur bei Auswahl** (`.selection-bar-active`) — leer hat
sie nichts zu zeigen, das oben bleiben müsste. Sie bekommt dann auch
`pointer-events: none`, damit sie keinen Griff abfängt, der der Tabelle
darunter galt.

## Komponenten

Neu: `src/SelectionBar.tsx`, rein darstellend — kein State, kein API-Aufruf.

```ts
interface SelectionBarProps {
  selectedCount: number
  openCount: number
  busy: boolean
  onCollect: () => void
  onDelete: () => void
  onClear: () => void
}
```

Bei `selectedCount === 0` rendert sie nur den Platzhalter.

`List` behält jeden Handler, den es heute hat (`handleCollectSelected`,
`handleDelete`, der Dialog, die SSE-Logik) — unverändert. Neu dort nur:

- `handleClearSelection` → `setCheckedIds(new Set())`
- die Leiste bekommt `selectedCount`, `openCount` und `busy`
- die beiden Buttons verlassen `.list-toolbar`

`busy` behält seine Bedeutung: `collecting || exporting || deleting`.

## Barrierefreiheit

- `role="region"` + `aria-label="Auswahl"` auf der Leiste
- `aria-live="polite"` auf der Zusammenfassung, damit die Anzahl beim Anhaken
  angesagt wird
- `Löschen` behält `aria-label="Ausgewählte löschen"`

## Tests

Zwei bestehende Selektoren in `web/manifest/src/List.test.tsx` brechen,
beide mechanisch:

- `collectToolbarButton()` sucht den Namen `'Kassieren'`; der Button heißt jetzt
  `'Kassieren (3)'` → `/^Kassieren \(/`. Nebeneffekt: er kann nicht mehr mit dem
  `Kassieren`-Button des Dialogs kollidieren.
- Der Test „closes the dialog and clears the selection after a successful run“
  benutzt den gesperrten Löschen-Button als Beweis für „`checkedIds` ist leer“.
  Der Button existiert dann nicht mehr → `queryByRole(...)
  .not.toBeInTheDocument()`. Gleiche Aussage, stärker.

Neu:

- ohne Häkchen: keine Auswahl-Leiste (kein `Kassieren`, kein `Löschen`)
- nur kassierte Zeilen angehakt: `Löschen (2)` da, `Kassieren` nicht
- gemischte Auswahl: `5 ausgewählt · 3 offen`, `Kassieren (3)`, `Löschen (5)`
- `Auswahl leeren` leert die Auswahl (Leiste verschwindet wieder)

## Dateien

| Datei | Änderung |
| --- | --- |
| `web/manifest/src/SelectionBar.tsx` | neu |
| `web/manifest/src/SelectionBar.test.tsx` | neu |
| `web/manifest/src/List.tsx` | Toolbar behält den Tag; Leiste rendern; `handleClearSelection` |
| `web/manifest/src/index.css` | `.selection-bar`, Platzhalter, Kommentar am `th`-Sticky |
| `web/manifest/src/List.test.tsx` | 2 Selektoren, 4 neue Fälle |

## Nicht Teil davon

- Der Zeilen-Button `✓ Kassiert` in `col-action` bleibt, wie er ist — er ist
  schon zeilennah und braucht kein Signal über Reichweite.
- Die Summen bleiben in der Tages-Toolbar. Sie beschreiben den Tag, nicht die
  Auswahl; eine „Summe der Auswahl“ wäre eine neue Funktion, nicht diese.
- `Tagesabschluss` bleibt im Tag-Block, obwohl es die Tabellen liest: es wirkt
  auf den Tag als Ganzes, nie auf eine Auswahl.
