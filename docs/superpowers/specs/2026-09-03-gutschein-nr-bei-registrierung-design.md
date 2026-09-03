# Gutschein-Nr. schon bei der Registrierung

Datum: 2026-09-03

## Problem

Ein Gast, der mit einem Gutschein anreist, hält die Nummer beim Ausfüllen des
Tablets bereits in der Hand. Getippt wird sie trotzdem erst später am Tisch:
Das Manifest ist heute die einzige Stelle, an der `voucher_number` entsteht
(siehe [Gutscheinprüfung](2026-08-10-gutscheinpruefung-design.md)). Der
Betreiber liest die Nummer also vom Papier des Gastes ab, während der Gast
danebensteht — genau die Abschrift, die der Gast selbst schon hätte machen
können.

Die Gutschein-Nr. wird deshalb im Gastformular erfasst. Sie ist das **einzige**
optionale Feld des Formulars; alle anderen bleiben Pflicht.

## Was der Gast sieht

Ein eigenes Feld-Set `Gutschein` hinter `Kontakt`, mit einem Feld:

```
─ Kontakt ───────────────
 E-Mail   [            ]
 Telefon  [            ]

─ Gutschein ─────────────
 Gutschein-Nr. (optional)
 [                     ]
 Falls du einen Gutschein hast.
```

Ein eigenes Feld-Set, weil eine Gutschein-Nr. keine Kontaktangabe ist und die
Legende sonst lügen würde. Am Ende, weil der Gast ohne Gutschein sonst vor
seinem eigenen Namen auf ein Feld stößt, das ihn nichts angeht.

Die Einleitungszeile `Alle Felder sind Pflichtfelder.` wird zu
`Alle Felder sind Pflichtfelder – bis auf die Gutschein-Nr.`

### Keine Prüfung gegen die Gutscheinliste

Das Tablet fragt `/api/voucher` **nicht**. Der Gast bekommt kein Urteil zu
sehen — weder „bezahlt“ noch „bereits eingelöst“ noch „storniert“. Ob ein
Gutschein gilt, ist eine Geldfrage zwischen Verein und Gast, und die gehört an
den Tisch und nicht auf ein Kiosk-Tablet, das der Gast allein bedient. Der
Betreiber sieht das Urteil unverändert im Manifest, an genau der Stelle, an der
er es heute sieht.

Folge davon: Ein Tippfehler des Gastes fällt erst am Tisch auf. Das ist
hinnehmbar — der Betreiber hat den Gutschein dann in der Hand und korrigiert
das Feld, wie er es heute ohnehin tut.

## Feldkette und Formularlogik

`FIELD_CHAIN` (`web/guest/src/useFieldChain.ts`) bekommt `voucherNumber` als
letzte Station. Damit wandern `LAST_FIELD`, `enterKeyHint: 'done'` und
Enter-löst-Absenden-aus mit, und die Pfeilnavigation erreicht das Feld ohne
Zusatzarbeit.

`field()` in `Form.tsx` setzt heute `required: true` und `aria-required` fest
verdrahtet für jedes Feld. Es bekommt ein Flag, mit dem dieses eine Feld
aussteigt. `validate()` erzeugt für `voucherNumber` nie einen Fehler, deshalb
bleiben `isValid`, `errors` und `firstErrorField` unberührt: Ein leeres Feld
kann das Absenden nicht blockieren und die Fehlerwanderung nicht auf ein Feld
lenken, das keinen Fehler haben kann.

Kein `inputMode`: Vereinsnummern sind nicht durchgehend numerisch, und ein
Ziffernblock würde genau die Nummern aussperren, die Buchstaben enthalten.

## Übertragung und Validierung

`RegistrationPayload` bekommt `voucher_number?: string`. Das Tablet sendet den
getrimmten Wert oder lässt das Feld weg, wenn es leer ist.

`validateGuest` (`src/server/validation.ts`) behandelt es als einziges Feld,
das fehlen darf:

- fehlt oder `''` nach `trim()` → die Registrierung hat keine Gutschein-Nr.
- vorhanden → muss ein String sein, wird getrimmt
- länger als 60 Zeichen → `Gutschein-Nr. ungültig`

Die Obergrenze ist kein Format, sondern eine Bremse: Ein hängender Scanner oder
ein eingeklemmtes Tablet darf keinen Roman in die Datenbank schreiben. Ein
Format wird bewusst nicht geprüft — die Nummernkreise des Vereins wechseln über
die Jahre, und der Abgleich mit der Liste macht ohnehin
`normaliseVoucherNumber`.

## Was der Server anlegt

`POST /api/registrations` schreibt bei vorhandener Nummer zwei Spalten statt
einer: `voucher_number` **und** `payment_method='voucher'`.

Der Gast, der eine Gutschein-Nr. angibt, sagt damit, wie er zahlen will. Die
Zeile im Manifest steht dann von Anfang an auf Gutschein, mit vorbelegter
Nummer und dem Listen-Urteil daneben; der Betreiber wählt nur noch Leistung und
Kasse. Zahlt der Gast am Tisch doch bar, stellt der Betreiber die Zahlungsart
um — und die bestehende Logik in `Detail.tsx` räumt Nummer und Leistung beim
Speichern selbst weg (`showVoucherNumber ? … : null`).

### Preis

Unverändert. `voucherCovered` liefert nur etwas, wenn `voucher_service` gesetzt
ist; das bleibt beim Anlegen `NULL`, und `voucherValue(null, prices)` ist `0`.
Die Zeile startet also weiterhin bei Sprungpreis plus Gewichtszuschlag. Erst
die Wahl der Leistung im Manifest zieht den Gutschein vom Betrag ab, wie
bisher.

### Vertrag

Der Vertrag muss beim Anlegen gestempelt werden, wenn eine Nummer dabei ist.
Das ist keine Kür, sondern Pflicht: Der Nachstempel in `PATCH` läuft nur, wenn
sich `voucher_number` **ändert** (`stampedChanged`). Speichert der Betreiber die
vom Gast eingetragene Nummer unverändert, ändert sich nichts — und der Vertrag
bliebe für immer ohne Nummer.

`POST` ruft deshalb nach `fillContractPdf` und vor `writeContractPdf`
`stampContract(pdf, { voucherNumber, tandemMaster: null })` auf, und nur dann,
wenn eine Nummer vorliegt. `stampContract` ist ausdrücklich wiederholbar und
zeichnet beide Kopffelder als Ganzes aus dem Zeilenstand — ein späterer
Nachstempel mit Tandemmaster nimmt die Nummer aus `current.voucher_number`
wieder mit, ein Löschen der Nummer wischt sie vom Vertrag.

Anders als der Nachstempel ist dieser Stempel **nicht** best-effort im
Hintergrund: Er passiert auf den Bytes im Speicher, bevor die Datei überhaupt
existiert. Schlägt er fehl, schlägt das Anlegen fehl — dieselbe Behandlung, die
`fillContractPdf` heute schon hat.

## Manifest

Keine Codeänderung. `Detail.tsx` liest `voucher_number` und `payment_method`
aus der Zeile, `showVoucherNumber` folgt daraus, und der bestehende
Prüf-Effekt läuft beim Öffnen mit nicht-leerer Nummer von selbst an. Die Zeile
öffnet mit ausgewählter Zahlungsart, gefülltem Feld und stehendem Urteil.

## Tests

| Ebene | Was |
| ----- | --- |
| `web/guest/src/Form.test.tsx` | Absenden mit leerem Feld möglich; getippter Wert erreicht `onNext`; Feld trägt kein `required` |
| `web/guest/src/useFieldChain.test.ts` | `voucherNumber` ist letzte Station |
| `src/server` (vitest) | `validateGuest`: fehlend ok, `''` ok, >60 Zeichen abgelehnt, Wert getrimmt |
| `src/server` (vitest) | `POST`: Nummer setzt `payment_method='voucher'`, Preis bleibt Sprungpreis + Zuschlag; ohne Nummer bleibt `payment_method` `NULL` |
| `tests/e2e/flow.spec.ts` | Ein Durchlauf mit ausgefüllter Nummer; die Manifest-Zeile öffnet auf Gutschein |
