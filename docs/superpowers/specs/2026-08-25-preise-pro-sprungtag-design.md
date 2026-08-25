# Preise und Vergütung gelten pro Sprungtag

Datum: 2026-08-25

## Was kaputt war

Der Preis eines Sprungs hatte drei Quellen, und welche man sah, hing vom Schirm ab:

| Schirm | Woher die Zahl kam |
| ------ | ------------------ |
| Liste, Summen „Offen/Kassiert" | `registrations.price` — beim Anlegen gespeichert |
| Excel-Export, Spalte „Preis" | derselbe gespeicherte Wert |
| Detailschirm „Zu kassieren" | **live** aus der aktuellen Preistabelle gerechnet |
| Export, Block „Vergütung" | **live** aus den aktuellen Sätzen, im Moment des Exports |

Also: Preis auf 280 ändern, und der Detailschirm sagt 280, während Liste und
Export weiter 270 sagen.

Zwei Folgeprobleme, die im selben Mechanismus steckten:

1. **Speichern hat neu bepreist.** Der Detailschirm schickt bei jedem Speichern
   `extra_booking` und `weight_surcharge` mit. Wer nur eine Load-Nr. eintrug,
   hat damit eine zwei Wochen alte, längst kassierte Zeile still auf die
   heutigen Preise gehoben. Der Preis war damit weder eingefroren noch aktuell,
   sondern änderte sich bei einer unbeteiligten Bearbeitung.

2. **Die Vergütung war nirgends gespeichert.** Der Export multiplizierte die
   Sprungzahlen mit den Sätzen, die *beim Export* in den Einstellungen standen.
   Ein Export vom letzten Samstag behauptete nach einer Satzerhöhung einen
   anderen Betrag als den, der tatsächlich ausbezahlt wurde.

Betroffen waren Sprungpreis, Zusatzbuchungen (Video, Video+Foto),
Gewichtszuschlag und Vergütung gleichermaßen. Einzige gewollte Ausnahme bleibt
der Gutschein: Er steht für eine Leistung, nicht für einen Betrag, und wird
weiterhin zum Tagespreis eingelöst.

## Die Regel

**Ein Sprungtag hat eine Preisliste, und die steht fest, sobald der Tag läuft.**

Die erste Anmeldung eines Tages kopiert die aktuellen Preise und
Vergütungssätze nach `day_tables`. Jede Zeile dieses Tages rechnet damit — die
vom Morgen wie die vom Abend. Was danach in den Einstellungen geändert wird,
gilt für den nächsten Tag.

Damit gibt es nur noch **eine** Zahl pro Sprung, und Liste, Detail und Export
lesen dieselbe.

### Was wann passiert

| Situation | Ergebnis |
| --------- | -------- |
| Preis ändern, **bevor** an diesem Tag jemand angemeldet ist | Der Tag ist noch nicht eingefroren und startet mit den neuen Preisen. |
| Preis ändern, **während** der Tag läuft | Der Tag bleibt bei seinen Preisen — auch für Gäste, die danach anreisen. Manifest und Detail sagen das an. |
| Zeile speichern (Load-Nr., Tandemmaster, …) | Neu gerechnet wird mit der Preisliste **des Tages**, es kommt also derselbe Betrag heraus. |
| Zusatzbuchung oder Zuschlag ändern | Ebenfalls aus der Tagesliste. |
| Manuell korrigierter Preis | Bleibt, was jemand eingetragen hat. |
| „Preise für diesen Tag aktualisieren" | Der Tag übernimmt die aktuellen Tabellen, und alle Zeilen ohne manuelle Korrektur werden neu gerechnet. |

Ein neuer Tag startet immer mit den neuesten Werten: Die Einstellungen sind die
Vorlage, ein Tageseintrag ist nur eine Kopie davon.

### Warum nicht pro Zeile

Ein Tag ist die Einheit, in der abgerechnet, exportiert und ausbezahlt wird.
Zwei Gäste desselben Tages, die verschieden viel zahlen, weil zwischen ihren
Anmeldungen jemand an der Preistabelle war, wären in der Kassa kein Vorteil,
sondern eine Rückfrage.

## Aufbau

| Datei | Aufgabe |
| ----- | ------- |
| `src/server/dayTables.ts` (neu) | `tablesForDay`, `startDay`, `dayIsFrozen`, `repriceDay` |
| `src/server/db.ts` | Tabelle `day_tables (jump_date, prices, payouts)` |
| `src/server/routes/registrations.ts` | friert den Tag bei der ersten Anmeldung ein, rechnet aus der Tagesliste; `GET /api/day-tables/:date`, `POST /api/day-tables/:date/reprice` |
| `src/server/routes/export.ts` | Vergütung mit den Sätzen des exportierten Tages |
| `web/manifest/src/List.tsx` | Banner samt Knopf, wenn Tag und Einstellungen auseinanderliegen |
| `web/manifest/src/Detail.tsx` | rechnet aus der Tagesliste statt aus den Einstellungen, mit Hinweis |
| `web/manifest/src/Betraege.tsx` | Hinweistexte sagen jetzt, ab wann eine Änderung gilt |

Eine bestehende Datenbank braucht keine Wanderung: `day_tables` entsteht beim
Start, und ein Tag ohne Eintrag wird mit den aktuellen Tabellen beantwortet —
für einen vergangenen Tag ist das die einzige Auskunft, die es je gab, und sie
ändert nichts an den bereits gespeicherten Preisen der Zeilen.

## Der Knopf

Im Manifest, über der Liste, weil dort ein Tag steht:

```
+-----------------------------------------------------------+
| Dieser Tag läuft auf der Preisliste von seinem Beginn      |
| (270 € pro Sprung, aktuell 280 €).                         |
|                    [ Preise für diesen Tag aktualisieren ] |
+-----------------------------------------------------------+
```

Der Detailschirm sagt dasselbe in einem Satz, hat den Knopf aber nicht: Die
Entscheidung betrifft den ganzen Tag, nicht eine Zeile.

## Tests

`tests/dayTables.test.ts` (neu, 13 Fälle)

- Die erste Anmeldung friert den Tag ein; eine spätere zahlt denselben Preis.
- Ein Tag ohne Anmeldung übernimmt eine Preisänderung.
- Speichern einer unbeteiligten Änderung bepreist nicht neu.
- Zusatzbuchung und Gewichtszuschlag rechnen aus der Tagesliste.
- `GET /api/day-tables/:date` meldet Tagesliste, aktuelle Liste und ob der Tag
  schon läuft; ungültiges Datum wird abgewiesen.
- Umstellen bewegt genau diesen Tag, lässt manuelle Korrekturen stehen und
  nimmt die Vergütungssätze mit.
- Der Export zahlt die Crew zu den Sätzen des exportierten Tages.

`web/manifest/src/List.test.tsx`, `Detail.test.tsx`

- Banner und Hinweis erscheinen nur, wenn der Tag läuft *und* abweicht; der
  Knopf ruft `repriceDay` und der Banner verschwindet erst, wenn der Server
  bestätigt.
- Der Detailschirm rechnet mit der Tagesliste, auch für eine neu gewählte
  Zusatzbuchung.

`tests/e2e/price-per-day.spec.ts` (neu, echter Browser)

Der gemeldete Fall von Anfang bis Ende: 270 einstellen, Gast anmelden, auf 280
ändern — Liste und Detail sagen beide 270, ein zweiter Gast desselben Tages
ebenfalls, Speichern ändert nichts, und der Knopf hebt den ganzen Tag auf 280.
