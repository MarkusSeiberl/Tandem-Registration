# Gutscheinprüfung gegen die Gutscheinliste des Vereins

Datum: 2026-08-10

Der Verein führt die ausgegebenen Gutscheine in einer eigenen Excel-Datei
(„Tandemliste.xlsx"). Das Manifest kennt sie bisher nicht: es nimmt jede
Gutschein-Nummer entgegen, ohne zu wissen, ob der Gutschein je bezahlt wurde,
und trägt nirgends ein, dass er eingelöst wurde.

Diese Änderung verbindet beide Seiten — lesend für die Prüfung, schreibend nur
für die eine Spalte „Eingelöst".

## Die Datei

Vier Spalten sind von Interesse:

| Spalte | Bedeutung |
| ------ | --------- |
| `LfdNr` | die Gutschein-Nummer, z. B. `26-001` |
| `EinzahlDat` | Datum der Einzahlung. Leer heißt: nicht bezahlt, nicht gültig |
| `Betrag` | Betrag, der damals bezahlt wurde |
| `Eingelöst` | Datum der Einlösung; hier trägt das Manifest ein |

Drei Dinge, die eine Beispieldatei zeigt und eine naive Umsetzung übersehen
würde:

**`EinzahlDat` hat drei Zustände, nicht zwei.** Neben einem Datum und leer steht
dort auch der Text `STORNO`. Jeder Nicht-Datums-Text gilt als ungültig und wird
**wörtlich angezeigt** — der Verein schreibt vielleicht morgen etwas anderes
hinein, und eine Liste erlaubter Wörter würde das nächste stillschweigend
durchlassen.

**`LfdNr` ist Text, keine Zahl.** `26-001` hat Jahrespräfix und führende Nullen.

**Die Beträge liegen unter den heutigen Preisen.** Tandem 255 € gegen heute
270 €, Tandem + Video 355 € gegen 370 €. Ein Vergleich auf Gleichheit würde bei
jedem Gutschein anschlagen. Das ist kein Fehler, sondern die bestehende Regel:
ein Gutschein steht für eine Leistung, nicht für einen Betrag, und wird zum
heutigen Preis eingelöst (`src/server/pricing.ts`).

## Pfad und Abschaltbarkeit

Neue Einstellung `voucherListPath`, im Einstellungen-Screen neben dem
Export-Verzeichnis. **Leer heißt: die Funktion existiert nicht** — keine
Statuszeile, keine Warnung, kein Fehler. Ein Verein ohne diese Datei soll keine
Maschinerie sehen, nach der er nicht gefragt hat.

Die Spalten werden über die **Überschriften in Zeile 1** gefunden, nicht über
feste Positionen. In der Datei steht bereits eine Spalte `Spalte1`; wer eine
weitere einfügt, darf den Leser nicht unbemerkt auf die falschen Daten
verschieben. Fehlt eine gebrauchte Überschrift, meldet die Zeile
„Gutscheinliste nicht lesbar" — sie wirft nicht.

## Lesen und Zwischenspeichern

`src/server/voucherList.ts` liest das erste Tabellenblatt in eine Map, geschlüsselt
nach normalisierter `LfdNr`. Der Zwischenspeicher hängt an Pfad, `mtime` und Größe
der Datei: eine Datei in OneDrive wird nur neu gelesen, wenn sie sich wirklich
geändert hat — nicht bei jedem Tastendruck — und eine Änderung, die der Verein
mitten am Tag macht, kommt ohne Neustart an.

**Normalisierung:** trimmen, Großbuchstaben, dann je Zifferngruppe führende Nullen
und Trennzeichen entfernen. Damit sind `26-001`, `26-1` und `26 001` dieselbe
Nummer. Treffen mehrere Zeilen auf die lose Form, meldet die Prüfung
**mehrdeutig**, statt sich eine auszusuchen. Eine doppelte `LfdNr` in der Liste
wird ebenso gemeldet.

## Statuszeile im Manifest

Die Prüfung läuft **automatisch**, kurz nachdem die Eingabe steht (350 ms), und
zeigt das Ergebnis im vorhandenen `Gutschein`-Block unter dem Nummernfeld — dort,
wo schon die Zeile „Noch 20,00 € offen" steht.

| Lage | Zeile |
| ---- | ----- |
| nicht gefunden | ⚠ Nummer nicht in der Gutscheinliste. |
| mehrdeutig | ⚠ Mehrere Gutscheine passen zu dieser Nummer. |
| `EinzahlDat` leer | ⚠ Nicht bezahlt — Gutschein ist nicht gültig. |
| `EinzahlDat` Text | ⚠ Storniert („STORNO"). |
| `Eingelöst` gesetzt | ⚠ Bereits eingelöst am 12.07.2026. |
| gültig | ✓ Bezahlt am 14.01.2026, noch nicht eingelöst. |
| Datei unlesbar | Gutscheinliste nicht lesbar. (neutral, keine Warnung) |

**Keine dieser Lagen blockiert etwas.** Speichern und Kassieren bleiben bedienbar.
Das folgt der Entscheidung, die für die fehlende Kassa schon getroffen wurde: das
Manifest muss eine Zeile auch halbfertig ablegen können, und wer vor dem Gast
steht, entscheidet — nicht die Software.

## Art gegen gebuchte Leistung

`Art` wird über Schlüsselwörter zugeordnet: *tandem* → Sprung, zusätzlich *video*
→ Sprung+Video, zusätzlich *foto* → Sprung+Video+Foto. Weicht das von der
gewählten Gutschein-Leistung ab, erscheint eine Hinweiszeile.

Zwei bewusste Ausnahmen:

- Eine `Art`, die auf kein Schlüsselwort passt, wird mit nichts verglichen. Lieber
  stumm als falsch.
- Ein Eintrag ohne *tandem* — in der Beispieldatei `Video + Foto zu GS25-2`, 120 €
  — ist ein **Zusatzgutschein**. Er deckt keinen Sprung ab; der Vergleich entfällt
  und die Zeile sagt das. Ohne diese Ausnahme läse er sich als
  Sprung+Video+Foto-Gutschein.

`Betrag` wird nie verglichen, nur angezeigt: `355,00 € damals · 370,00 € heute`.

## Einlösen

Zwei Spalten auf `registrations`:

- `voucher_redeemed_at` — wann **wir** die Einlösung festgestellt haben.
- `voucher_redeem_synced_at` — wann sie in der Excel-Datei angekommen ist.

**Die Datenbank ist die Aufzeichnung, die Excel-Datei eine Kopie, die wir
nachziehen.** Nur deshalb übersteht eine gesperrte Datei den Tag.

### Wann geschrieben wird

Geschrieben wird **nur**, wenn der Gutschein gültig ist **und** die Zelle
`Eingelöst` leer ist:

| Lage beim Kassieren | Was passiert |
| ------------------- | ------------ |
| gültig, `Eingelöst` leer | Datum eintragen, `voucher_redeemed_at` und `voucher_redeem_synced_at` setzen |
| gültig, `Eingelöst` gesetzt | nichts eintragen, nichts beanspruchen — das Datum gehört jemand anderem |
| ungültig (nicht bezahlt, storniert, unbekannt, mehrdeutig) | nichts eintragen, keine Einlösung vermerken |
| Datei gesperrt oder unlesbar | `voucher_redeemed_at` setzen, `synced_at` leer lassen — technischer Fehlschlag, wird wiederholt |

Damit heißt **offen** genau eine Sache: ein Schreibversuch, der technisch
misslungen ist. Ungültige Gutscheine sammeln sich nicht in einem Zähler, der
nie auf null geht.

### Auslöser

1. **Kassieren.** Wird eine Gutschein-Zeile auf kassiert gesetzt, läuft der
   Schreibversuch.
2. **Export.** Der Export holt jede Zeile nach, die eingelöst, aber noch nicht
   geschrieben ist. Stellt sich dabei heraus, dass der Gutschein inzwischen doch
   ungültig ist, wird `voucher_redeemed_at` zurückgenommen und die Zeile im
   Ergebnis gemeldet, statt weiter in der Warteschlange zu stehen.

### Sicherung

Vor dem ersten Schreibvorgang eines Tages wird die Liste nach
`Gutschein-Backup/Tandemliste_2026-08-10.xlsx` kopiert (im Backup-, sonst im
Export-Verzeichnis). Existiert die Kopie schon, passiert nichts.

Das Tabellenblatt der Beispieldatei ist einfach — keine Tabellen, keine bedingte
Formatierung, keine verbundenen Zellen, keine Bilder, keine benannten Bereiche —
weshalb ein Lese-Schreib-Durchlauf mit ExcelJS wenig gefährdet. Die Sicherung
steht trotzdem: es ist die einzige Aufzeichnung des Vereins über seine
Gutscheine.

### Zurücknehmen

Wird eine Zeile wieder auf offen gesetzt und war noch nichts geschrieben, fällt
die Einlösung weg. War sie schon geschrieben, **bleibt das Datum in der Datei
stehen** und die Detailansicht sagt es. Ein Datum still aus der Datei des Vereins
zu löschen ist schlimmer als ein veraltetes, das ein Mensch korrigieren kann.

### Sichtbarkeit

Die Listenansicht zeigt, wenn offene Einträge existieren:
„2 Einlösungen noch nicht in die Gutscheinliste geschrieben."
Das Export-Ergebnis nennt geschriebene, offene und wegen Ungültigkeit
ausgelassene Zeilen.

## Schnittstelle

`GET /api/voucher?number=26-001` liefert den geprüften Zustand — nur der Server
kommt an die Datei. Antwort: Status, Einzahldatum, Betrag, Art, abgeleitete
Leistung, Einlösedatum.

## Tests

Server:

- Normalisierung: `26-1`, `26 001` und `26-001` finden dieselbe Zeile; Mehrdeutigkeit meldet sich.
- Jede Statuslage, einschließlich `STORNO` und beliebigem anderem Text in `EinzahlDat`.
- Art-Zuordnung inklusive Zusatzgutschein ohne *tandem*.
- Zwischenspeicher liest neu, sobald sich die Datei ändert.
- Sicherung wird einmal pro Tag angelegt, nicht bei jedem Schreibvorgang.
- Einlösedatum wird geschrieben; ein vorhandenes Datum bleibt unangetastet.
- Ungültiger Gutschein schreibt nichts und hinterlässt keine offene Zeile.
- Gesperrte Datei lässt die Zeile offen; der Export holt sie nach.
- Fehlender Pfad schaltet die Funktion ab, ohne Fehler.

Manifest:

- Jede Statuszeile erscheint.
- Speichern und Kassieren bleiben in jeder Fehlerlage bedienbar.
