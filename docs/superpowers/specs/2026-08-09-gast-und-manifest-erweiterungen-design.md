# Pflichtfelder, Anmerkungen, Datenschutz, Gutschein-Nr. und Auto-Zuschlag

Datum: 2026-08-09

Fünf Änderungen, die sich eine Migration teilen. Sie hängen inhaltlich nicht
zusammen, treffen aber dieselben Dateien — deshalb ein Dokument.

## 1. Pflichtfelder im Gastformular

Es gibt keine optionalen Felder. `validate()` in `web/guest/src/Form.tsx` prüft
alle elf Felder, „Weiter" bleibt bis dahin gesperrt, und `validateGuest()` in
`src/server/validation.ts` spiegelt dieselben Regeln serverseitig. Die Lücke ist
eine andere: dem Gast sagt nichts, dass ein Feld Pflicht ist, bevor er es leer
verlassen hat.

- `required` und `aria-required="true"` an jedem Eingabefeld, `aria-invalid` an
  einem Feld mit Fehler. `noValidate` bleibt am Formular, damit weiterhin die
  deutschen Meldungen erscheinen und nicht die des Browsers.
- Unter der Überschrift steht „Alle Felder sind Pflichtfelder."
- Ein Test iteriert über die Feldnamen und verlangt für jedes eine Fehlermeldung,
  wenn es leer ist. Damit fällt ein künftig hinzugefügtes Feld ohne Regel auf.

## 2. Anmerkungen

Spalte `notes TEXT`, in der Detailansicht ein Textfeld **unter** dem Preisblock:
eine Notiz über eine Sondervereinbarung gehört hinter die Zahlen, die sie
erklärt, nicht zwischen die Auswahlfelder. Hinweis darunter: „Besondere
Vereinbarungen, Abweichungen, Sonderfälle."

Leerer Text wird als `null` gespeichert. `notes` kommt in die `ALLOWED`-Liste der
PATCH-Route; als Freitext ohne Enum-Prüfung, aber getrimmt.

Im Excel-Export eine letzte Spalte „Anmerkungen". `Column` bekommt dafür ein
optionales `width`: bei den einheitlichen 18 Zeichen wäre die Anmerkung
abgeschnitten und damit wertlos.

## 3. Datenschutz-Checkbox

Der Vertragstext enthält bereits den Satz „Ich bin damit einverstanden, dass
meine umseitigen persönlichen Daten automatisationsunterstützt gespeichert und
verwaltet werden." — eingebettet in eine Textwand und im selben Absatz mit einer
Werbe-Einwilligung. Genau diese Bündelung erkennt Art. 7 Abs. 2 DSGVO nicht an.
Die Checkbox holt den Punkt heraus und macht ihn sichtbar.

**Rechtsgrundlage.** Name, Adresse, Gewicht und Vertragsdaten werden zur
Erfüllung des Beförderungsvertrags verarbeitet, Art. 6 Abs. 1 lit. b DSGVO. Dafür
ist keine Einwilligung nötig, und eine Einwilligung wäre hier sogar schwächer:
sie ist widerrufbar, und ein Gast könnte daraus die Löschung eines Sprungdatensatzes
ableiten, den der Verein aufbewahren muss. Die Checkbox ist deshalb eine
**Kenntnisnahme** der Datenschutzinformation (Informationspflicht nach Art. 13),
keine Einwilligung.

- Neuer Konfigurationsschlüssel `privacyText` mit deutschem Standardtext, geliefert
  über `GET /api/privacy` — anders als `/api/contract` in `index.ts` registriert,
  damit die Route von den Server-Tests erreichbar ist.
- Der Standardtext enthält **Platzhalter** für Verantwortlichen (Name, Anschrift,
  Kontakt) und Aufbewahrungsdauer. Diese Angaben erfindet niemand; der Verein
  trägt sie ein.
- Im Gast-Screen `Contract.tsx` steht der Block über dem Unterschriftsfeld:
  Kurzfassung, aufklappbarer Volltext, Pflicht-Checkbox. Die Freigabe von „Weiter"
  lautet danach `hasDrawn && scrolledToEnd && privacyAccepted`.
- Die Nutzlast bekommt `privacy_ack: true`; `validateGuest` weist eine
  Registrierung ohne dieses Feld zurück. Den Zeitstempel `privacy_ack_at` schreibt
  der Server — eine Tablet-Uhr entscheidet nicht, wann eine Kenntnisnahme erfolgt ist.
- Alte Zeilen behalten `NULL`. Das heißt: vor dieser Änderung registriert, nicht
  „hat verweigert".
- `Settings.tsx` bekommt Textfelder für **Datenschutztext und Vertragstext**. Der
  Vertragstext ist heute nur in `config.json` änderbar; ein Feld für den neuen
  Text ohne eines für den alten wäre die Ausnahme statt der Regel.

## 4. Gutschein-Nr. auf dem Vertrag

Die Unterschrift wird nicht gespeichert (`db.ts` löscht `signature_png`), das PDF
entsteht einmal bei der Registrierung. Ein Neuaufbau aus der Vorlage ist damit
unmöglich, ohne die Unterschrift dauerhaft in der Datenbank zu halten — was der
Datenschutzarbeit in Punkt 3 zuwiderliefe. Stattdessen wird das vorhandene PDF
gestempelt.

`stampVoucherNumber(pdfBytes, voucherNumber)` in `contractPdf.ts` lädt das
gespeicherte PDF, zeichnet ein **weißes Rechteck** über die linke obere Ecke und
darauf „Gutschein-Nr.: XYZ". Das Rechteck macht den Stempel wiederholbar: eine
korrigierte Nummer hinterlässt keinen Schatten der alten, und eine gelöschte
Nummer verschwindet ganz.

Ausgelöst wird das in der PATCH-Route, wenn sich `voucher_number` tatsächlich
geändert hat und die Zeile ein `contract_pdf_filename` trägt.

**Ein Fehler beim Stempeln bricht das Speichern nicht ab**, sondern wird geloggt.
Die Datenbankzeile ist die maßgebliche Aufzeichnung; einen Kassa-Eintrag wegen
einer gesperrten PDF-Datei zu verlieren, wäre der teurere Fehler. Das Ergebnis
sieht das Manifest über „Vertrag öffnen".

Die Koordinaten sind gegen die echte Vorlage zu prüfen: ein Muster erzeugen,
ansehen, nachjustieren. Jeder Stempel schreibt die Datei über pdf-lib neu und
vergrößert sie geringfügig — bei den wenigen Korrekturen eines Sprungtages ohne
Belang.

## 5. Automatischer Gewichtszuschlag

Bisher wurde der Zuschlag bewusst nie aus dem Gewicht abgeleitet, weil das
Manifest ihn im Einzelfall erlässt. Beides geht zusammen, wenn die Ableitung
**einmalig** ist:

- `surchargeForWeight(kg)` in `src/server/pricing.ts`: ab 100 kg `over_100`, ab
  90 kg `over_90`, sonst `none`.
- Der INSERT schreibt statt des festen `'none'` diesen Wert und gibt ihn an
  `computePrice` weiter. Die Zeile erscheint damit sofort mit richtigem Zuschlag
  **und** richtigem Preis in der Liste.
- Beim PATCH wird nie neu abgeleitet. Was das Manifest wählt, bleibt stehen.
- Der Hinweis unter dem Auswahlfeld lautet „95 kg — Zuschlag ab 90 kg wäre
  fällig.", sobald die Auswahl vom Gewicht abweicht. Der Kommentar im Detail-Screen,
  der heute die gegenteilige Regel behauptet, wird ersetzt.

`web/manifest/src/pricing.ts` bekommt dieselbe Funktion — der Server kann aus dem
eigenen Vite-Projekt des Manifests nicht importieren, wie schon bei den Labels.

## Schema

Eine Migration, zwei Spalten: `notes` und `privacy_ack_at`. Punkt 4 und 5
brauchen keinen Speicher.

## Tests

Server:

- `validation`: Registrierung ohne `privacy_ack` wird abgelehnt.
- `pricing`: Grenzen bei 89, 90, 99, 100 kg.
- `contractPdf`: Stempel bleibt bei wiederholtem Aufruf sauber, leere Nummer löscht ihn.
- `excel`: Spalte „Anmerkungen" trägt den Text und ihre eigene Breite.
- `registrations`: INSERT setzt Zuschlag und Preis aus dem Gewicht; PATCH leitet nie neu ab.

Web:

- `Form.test.tsx`: Pflichtkennzeichnung vorhanden, jedes Feld hat eine Regel.
- `Contract.test.tsx`: „Weiter" bleibt ohne Häkchen gesperrt, auch mit Unterschrift
  und gelesenem Text.
- `Detail.test.tsx`: Anmerkung wird geladen und gespeichert, Abweichungshinweis
  erscheint nur bei Abweichung.
