# Offen/Kassiert-Split und Vergütung für Tandemmaster und Videoflieger

Datum: 2026-08-01

## Problem

1. Bezahlt wird (außer beim Gutschein) erst **nach** dem Sprung. In einer einzigen
   Liste verschwinden die noch offenen Tandems zwischen den bereits abgeschlossenen.
   Das Manifest braucht die offenen Fälle getrennt im Blick.
2. Tandemmaster und Videoflieger bekommen pro Sprung Geld. Am Tagesende steht
   nirgends, wer wie viel bekommt — und schon gar nicht, wie sich der Betrag
   zusammensetzt.

## Teil 1 — Offen / Kassiert

### Zustand

Neue Spalte `paid_at TEXT` auf `registrations`:

| Wert            | Bedeutung |
| --------------- | --------- |
| NULL            | offen — noch nicht kassiert |
| ISO-Zeitstempel | kassiert, zum genannten Zeitpunkt |

Nachgezogen in `migrate()` wie jede Spalte nach dem Erstrelease.

Ein eigenes Feld statt einer Ableitung aus `payment_method`: die Zahlungsart wird
oft schon bei der Aufnahme gesetzt, das Geld fließt aber erst nach der Landung.
Abgeleitet würde die Zeile zu früh nach unten springen.

### API

`PATCH /api/registrations/:id` nimmt zusätzlich `paid: boolean`. Der **Server**
setzt daraus `paid_at`:

```
paid === true  → paid_at = new Date().toISOString()
paid === false → paid_at = null
```

Der Client schickt keinen Zeitstempel — mehrere Tablets mit abweichender Uhr
würden die Reihenfolge verfälschen. `paid` steht nicht in `ALLOWED`, sondern wird
vor dem Update in `paid_at` übersetzt. Ein bereits kassierter Datensatz, der
erneut `paid: true` bekommt, behält seinen ursprünglichen Zeitstempel.

Die Preisberechnung bleibt unberührt: `paid` steht nicht in `PRICING_FIELDS`.

### Manifest-Liste

`rows` teilt sich in zwei Tabellen, beide weiter nach Load-Nr. absteigend sortiert:

```
Offen (n)      paid_at === null      oben
Kassiert (n)   paid_at !== null      unten
```

- Gleiche Spalten in beiden Tabellen, plus eine neue letzte Spalte mit der Aktion:
  offen → Button „✓ Kassiert", kassiert → Icon-Button „↩" (aria-label
  „Als offen markieren").
- Der Aktionsbutton stoppt die Klick-Weitergabe, damit der Zeilenklick weiterhin
  das Detail öffnet.
- Toolbar zeigt zwei Summen statt einer: `Offen: X €` und `Kassiert: Y €`.
  Die Eintragszahl bleibt die Gesamtzahl des Tages.
- Die untere Tabelle ist optisch zurückgenommen (gedämpfte Kopfzeile), damit der
  Blick bei den offenen Fällen bleibt.
- Leerzustand je Tabelle: „Keine offenen Einträge." / „Noch nichts kassiert."
- Checkbox-Auswahl und Löschen bleiben unverändert und gelten über beide Tabellen.

### Export

Der Excel-Export umfasst weiter den ganzen Tag; der Kassiert-Status taucht dort
nicht auf. Er ist eine Arbeitshilfe für den laufenden Betrieb, keine Buchungsgröße.

## Teil 2 — Vergütung

### Konfiguration

Neuer Block neben `prices`:

```ts
payouts: {
  tandem_master: number  // 45
  video: number          // 60
  video_photo: number    // 80
}
```

`loadConfig` mischt die Vorgaben pro Schlüssel ein, `PUT /api/settings` prüft jeden
Wert als endliche Zahl ≥ 0 und mischt verschachtelt — dieselbe Regel wie bei
`prices`, umgesetzt über einen gemeinsamen Helfer statt einer zweiten Kopie.

### Rechenregel

Neues Modul `src/server/payouts.ts`, getrennt von der Excel-Ausgabe und damit
testbar wie `pricing.ts`:

```ts
interface PayoutEntry   { name: string; calculation: string; amount: number }
interface PayoutSection { title: string; entries: PayoutEntry[]; total: number }

payoutSections(rows, masterNames, flyerNames, payouts): PayoutSection[]
```

**Tandemmaster** — gruppiert nach `tandem_master_id`, ein Satz pro Sprung:

```
Seiberl Markus    3 × 45,00 €    135,00 €
```

**Videoflieger** — nur Zeilen, deren gebuchte Leistung Video enthält, gruppiert
nach `camera_flyer_id`, je Satz gezählt:

```
extra_booking = video        → payouts.video
extra_booking = video_photo  → payouts.video_photo

Hofer Lisa    1 × 60,00 € + 1 × 80,00 €    140,00 €
```

Regeln:

- Die Vergütung folgt dem **Sprung**, nicht dem Geld: Gutschein-Gäste und noch
  offene (nicht kassierte) Zeilen zählen voll mit.
- Der Satz des Videofliegers kommt aus der **geflogenen** Leistung
  (`extra_booking`), nicht aus der Gutschein-Leistung — ein per Gutschein
  abgedecktes Video zählt damit ebenso.
- Ein abweichender Preis (`price_override`) ändert nichts: die Sätze sind pauschal.
- Zeilen ohne Zuordnung erscheinen als „ohne Tandemmaster" bzw. „ohne
  Kameraflieger" und stehen immer zuletzt. So verschwindet kein Sprung still.
- Sortierung sonst alphabetisch nach Name.
- Eine Sektion ohne Einträge wird weggelassen.
- Die Beträge werden im Modul selbst formatiert (kein `Intl`), damit die Zeichenkette
  in Tests und im gepackten exe identisch ist.

### Excel

`buildWorkbook(rows, columns, meta, totals, payouts)`. Unter dem Summenblock, nach
einer Leerzeile, je Sektion:

```
Vergütung Tandemmaster
Seiberl Markus     3 × 45,00 €                  135,00 €
Gruber Hans        1 × 45,00 €                   45,00 €
Summe                                           180,00 €

Vergütung Videoflieger
Hofer Lisa         1 × 60,00 € + 1 × 80,00 €    140,00 €
Summe                                           140,00 €
```

Spalten A–C (Name | Rechnung | Betrag). Titel- und Summenzeile fett, Betrag als
echte Zahl mit Format `#,##0.00 "€"`. Die Breiten von A–C werden auf
`max(bisherige Breite, benötigte Breite)` gezogen — die Rechnung wird nicht
abgeschnitten und die Gästetabelle bleibt lesbar.

### Einstellungen

Neuer Abschnitt „Vergütung (EUR)" mit drei Zahlenfeldern (Tandemmaster pro Sprung,
Videoflieger Video, Videoflieger Video + Foto). Gleiche String-State- und
Validierungslogik wie der Abschnitt „Preise".

## Tests

| Datei | Was |
| ----- | --- |
| `tests/payouts.test.ts` (neu) | Gruppierung, Satz-Buckets, „ohne …"-Zeilen, Rechen-Zeichenkette, leere Sektionen |
| `tests/db.test.ts` | Migration `paid_at` |
| `tests/manifest-update.test.ts` | `paid: true/false` setzt/löscht `paid_at`, Preis unberührt |
| `tests/config.test.ts` | Vorgaben-Merge für `payouts` |
| `tests/settings.test.ts` | Validierung und verschachteltes Mischen von `payouts` |
| `tests/excel.test.ts` | Vergütungsblock: Zeilen, Format, ausgelassene leere Sektion |
| `tests/export.test.ts` | Block im erzeugten Tagesexport |
| `web/manifest/src/List.test.tsx` | Split, Button verschiebt Zeile, zwei Summen |

## Nicht enthalten

- Kassiert-Spalte im Excel-Export.
- Sammel-Aktion, um mehrere Zeilen auf einmal als kassiert zu markieren.
