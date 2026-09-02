# Übergewichts-Zuschlag in der Tandemmaster-Vergütung

Datum: 2026-09-02

## Problem

Ein Gast ab 90 kg kostet den Verein mehr — der Gast zahlt dafür seit
[Preise und Zuschläge](2026-07-28-preise-und-zuschlaege-design.md) einen
Zuschlag. Der Tandemmaster, der den schwereren Sprung tatsächlich fliegt,
bekommt davon bisher nichts. Er soll zusätzlich zur Sprungpauschale bekommen:

| Zuschlag der Zeile | Vergütung Tandemmaster |
| ------------------ | ---------------------- |
| `over_90`          | 15,00 € (Vorgabe)      |
| `over_100`         | 25,00 € (Vorgabe)      |

Beide Beträge sind in den Stammdaten einstellbar, wie jeder andere Preis- und
Vergütungsbetrag auch, und erscheinen im Vergütungsblock des Tagesexports.

## Was der Zuschlag auslöst

Maßgeblich ist das gespeicherte Feld `weight_surcharge` der Zeile
(`none` / `over_90` / `over_100`) — **nicht** `weight_kg`.

`weight_surcharge` wird beim Anlegen der Registrierung einmalig aus dem Gewicht
abgeleitet (`surchargeForWeight`) und danach nie neu berechnet, weil das Manifest
den Zuschlag als Ausnahme erlassen können muss. Erlässt das Manifest den
Zuschlag, entfällt damit auch die Zusatzvergütung: Es gibt einen Zuschlag, und
über den entscheidet das Manifest einmal — für den Gast und für den Master
gleichzeitig. Eine zweite, davon abweichende Wahrheit über dasselbe Tandem wäre
ein Feld, das niemand pflegt.

## Konfiguration

`Payouts` bekommt zwei Beträge, benannt wie ihre Gegenstücke in `Prices`:

```ts
export interface Payouts {
  tandem_master: number
  video: number
  video_photo: number
  weight_over_90: number
  weight_over_100: number
}

export const PAYOUT_KEYS = [
  'tandem_master', 'video', 'video_photo', 'weight_over_90', 'weight_over_100',
] as const

export const DEFAULT_PAYOUTS: Payouts = {
  tandem_master: 45, video: 60, video_photo: 80,
  weight_over_90: 15, weight_over_100: 25,
}
```

`routes/settings.ts` prüft und mischt beide Blöcke bereits über ihre
Schlüssellisten (`AMOUNT_BLOCKS`) — die neuen Beträge werden dort ohne Änderung
validiert (Zahl, endlich, `>= 0`) und schlüsselweise gemischt. Ebenso
`loadConfig`, das `payouts` über `DEFAULT_PAYOUTS` spreizt: eine config.json aus
einer älteren Version bekommt die Vorgabewerte.

`config.example.json` wird um beide Beträge ergänzt.

## Alte Sprungtage bekommen keinen Zuschlag

Ein Sprungtag friert seine Tabellen bei der ersten Registrierung in `day_tables`
ein. Snapshots, die vor dieser Änderung geschrieben wurden, kennen die beiden
neuen Schlüssel nicht. `dayTables.parse` spreizt einen Snapshot heute über die
**aktuelle** Konfiguration — ein Re-Export des letzten Monats würde damit
rückwirkend eine Vergütung ausweisen, die an dem Tag niemand vereinbart und
niemand ausbezahlt hat, und nicht mehr zu dem Blatt passen, das der Verein längst
abgerechnet hat.

Deshalb fallen genau diese beiden Beträge für eingefrorene Tage auf `0` zurück:

```ts
// Beträge, die es noch nicht gab, als ältere Snapshots geschrieben wurden. Ein
// eingefrorener Tag, der sie nicht nennt, wurde ohne sie geflogen.
const PAYOUTS_BEFORE: Partial<Payouts> = { weight_over_90: 0, weight_over_100: 0 }

payouts: { ...fallback.payouts, ...PAYOUTS_BEFORE, ...safeParse(row.payouts) }
```

Nur in `parse`, also nur für Tage, die tatsächlich einen Snapshot haben.
`currentOf` bleibt unberührt: ein neuer Tag friert die echten Beträge ein, und
ein Tag ohne Snapshot wird weiterhin mit den heutigen Beträgen angezeigt.
`prices` bleibt vollständig unberührt.

`repriceDay` braucht keine Änderung — es schreibt den Snapshot aus der aktuellen
Konfiguration neu, und die enthält die Beträge.

## Vergütungsberechnung

`payouts.ts` kennt bereits das Konzept mehrerer Sätze pro Person: `Tally` mit
`order`, `rate`, `count`, gerendert als `"3 × 45,00 € + 1 × 60,00 €"`. Der
Zuschlag ist ein weiterer Satz in derselben Zeile — kein eigener Block, keine
eigene Spalte. Die Summe des Tandemmaster-Blocks bleibt damit das, was der Master
für den Tag bekommt.

`PaidRow` bekommt `weight_surcharge?: string | null`. Je Zeile, nach der
Sprungpauschale:

```
over_90  → record(masters, name, 'over_90',  order 1, payouts.weight_over_90)
over_100 → record(masters, name, 'over_100', order 2, payouts.weight_over_100)
```

Die `order`-Werte halten die Reihenfolge `Sprung + ab 90 kg + ab 100 kg` fest,
unabhängig davon, in welcher Reihenfolge die Zeilen kommen.

**Ein Satz von 0 € wird nicht erfasst.** Sonst bekäme jeder Export eines alten
Tages — und jeder Verein, der keinen Zuschlag ausbezahlt — Zeilen wie
`+ 2 × 0,00 €`, die nichts aussagen und die Rechnung nur verlängern.

Die Sammelzeile „ohne Tandemmaster" bekommt den Zuschlag wie jeder Name: sie ist
eine offene Aufgabe, und was dort steht, muss zu dem passen, was nach dem
Zuordnen dasteht.

Ergebnis im Blatt:

```
Vergütung Tandemmaster
Anna Huber   3 × 45,00 € + 1 × 15,00 €   150,00 €
Bert Maier   2 × 45,00 € + 1 × 25,00 €   115,00 €
Summe                                    265,00 €
```

## Excel-Export

Strukturell unverändert: `buildWorkbook` schreibt die Rechnung als Text, sie wird
nur länger. Die Spaltenbreiten des Vergütungsblocks sind auf drei Spalten
abgestimmt (`PAYOUT_COLUMN_WIDTHS = [26, 30, 14]`); eine Rechnung mit beiden
Zuschlägen ist rund 38 Zeichen lang und würde bei 30 abgeschnitten. Die mittlere
Breite steigt daher auf **40**.

Die Gästezeilen ändern sich nicht — die Spalte „Zuschlag" zeigt bereits, welcher
Zuschlag für die Zeile galt, und damit auch, woher der Betrag des Masters kommt.

## Stammdaten-Oberfläche

`Betraege.tsx`, Block „Vergütung (EUR)", zwei zusätzliche Felder unter den
bestehenden:

```ts
{ key: 'weight_over_90',  label: 'Tandemmaster Zuschlag ab 90 kg' },
{ key: 'weight_over_100', label: 'Tandemmaster Zuschlag ab 100 kg' },
```

Dazu die beiden Schlüssel in `EMPTY_PAYOUTS` und im Anfangszustand von
`payoutInputs`. `toAmounts` / `toInputs` laufen über `PAYOUT_FIELDS` und brauchen
keine Änderung; die bestehende Prüfung („leer, nicht endlich oder negativ ist
ungültig") gilt damit auch für die neuen Felder.

`web/manifest/src/api.ts` bekommt die beiden Schlüssel im `Payouts`-Typ.

Sonst nichts: Vergütungsbeträge erscheinen nirgends außer im Export — weder in
der Liste noch in der Detailansicht.

## Tests

| Datei | Was gepinnt wird |
| ----- | ---------------- |
| `tests/payouts.test.ts` | Zuschlag als zweiter Satz in der Rechnung; Reihenfolge Sprung → 90 → 100; Satz 0 € erzeugt keinen Eintrag; erlassener Zuschlag (`none`) erzeugt keinen; „ohne Tandemmaster" bekommt ihn ebenfalls |
| `tests/dayTables.test.ts` | Snapshot ohne die neuen Schlüssel liefert 0, nicht den heutigen Betrag; neuer Tag friert die echten Beträge ein; `prices` unberührt |
| `tests/config.test.ts` | Vorgaben 15/25; config.json ohne die Schlüssel bekommt sie ergänzt |
| `tests/settings.test.ts` | Negativer/nicht-numerischer Zuschlag wird mit 400 abgelehnt; ein Client, der nur `tandem_master` schickt, löscht die Zuschläge nicht |
| `tests/export.test.ts` | Rechnung mit Zuschlag steht im Blatt; Summe stimmt |
| `web/manifest/src/Betraege.test.tsx` | Beide Felder werden geladen und mitgespeichert |

## Nicht Teil dieser Änderung

- Kameraflieger bekommen keinen Übergewichts-Zuschlag: sie fliegen neben dem
  Tandem, das Gewicht des Gastes ändert an ihrer Arbeit nichts.
- Der Zuschlag bleibt an die zwei bestehenden Schwellen gebunden. Frei
  definierbare Schwellen wären eine Änderung an `surchargeForWeight`, am
  gespeicherten Enum und an der Gästepreisliste — und niemand hat danach gefragt.
