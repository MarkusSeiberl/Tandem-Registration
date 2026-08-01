# Bedingte Felder und Löschen in der Detailansicht

Datum: 2026-08-01

## Problem

In der Detailansicht tauchen Felder auf und verschwinden wieder, ohne dass
erkennbar ist warum. Am deutlichsten bei „Zuzahlung bezahlt mit": das Feld steht
**über** der Gutschein-Leistung und der gebuchten Leistung — also über den beiden
Feldern, die seinen Betrag bestimmen. Wer unten die gebuchte Leistung ändert,
sieht weit oben etwas aufspringen und weiß nicht, was passiert ist.

Zusätzlich fehlt in der Detailansicht eine Möglichkeit, die Registrierung zu
löschen; das geht bisher nur über die Liste.

## Gutschein-Block

Die drei Gutschein-Felder werden ein `fieldset` mit `legend` „Gutschein", das als
Ganzes erscheint, sobald die Zahlungsart „Gutschein" ist — direkt unter dem
Auswahlfeld, das es auslöst. Reihenfolge im Block:

1. Gutschein-Nr.
2. Gutschein-Leistung
3. Statuszeile
4. Zuzahlung bezahlt mit

Damit steht die Zuzahlung unter den Feldern, die ihren Betrag bestimmen, und im
Formular springt nur noch eine Sache: der Block selbst, sichtbar gekoppelt an die
Zahlungsart.

## Statuszeile

Sie sagt, warum das Zuzahlungsfeld gerade so ist, wie es ist:

| Lage | Text | Zuzahlungsfeld |
| ---- | ---- | -------------- |
| Betrag offen, Kassa gewählt | „Noch 20,00 € offen — bitte Kassa wählen." | aktiv |
| Betrag offen, keine Kassa | gleicher Text, Warnfarbe | aktiv |
| Nichts offen | „Gutschein deckt alles ab — nichts zu kassieren." | gesperrt, leer |

Der Warnzustand ist der eigentliche Fehlerfall — die Kassa geht abends nicht auf,
weil hier nichts steht. Er blockiert das Speichern **nicht**: das Manifest muss
eine Zeile auch halbfertig ablegen können.

Der Betrag in der Zeile ist der zu kassierende Gesamtbetrag (`due`), also inklusive
Gewichtszuschlag und abzüglich Gutschein — dieselbe Zahl wie „Zu kassieren".

## Kameraflieger

Das Feld bleibt immer stehen. Ohne gebuchtes Video ist es gesperrt und trägt den
Hinweis „Kein Video gebucht." Sichtbar ist es damit immer; nur bedienbar, wenn ein
Video geflogen wird (gebuchte Leistung **oder** Gutschein-Leistung mit Video).

Gespeichert wird wie bisher: ein gesperrtes Feld schickt `null`, damit keine
veraltete Auswahl hängen bleibt. Das gilt genauso für die Zuzahlung, sobald nichts
mehr offen ist.

## Löschen

Neuer Button in der Aktionszeile unten, abgesetzt von „Speichern", mit
Papierkorb-Icon und rotem Rahmen. Rückfrage „Registrierung von Vorname Nachname
löschen?", dann `DELETE /api/registrations/:id` (löscht serverseitig auch das
Vertrags-PDF) und zurück zur Liste über das vorhandene `onBack`. Die Liste
aktualisiert sich über das bestehende SSE-Event; ein neuer Prop ist nicht nötig.

Bricht die Rückfrage ab, passiert nichts. Schlägt der Aufruf fehl, bleibt die
Ansicht offen und zeigt die Fehlermeldung an der gewohnten Stelle.

## Tests

Erweitert `web/manifest/src/Detail.test.tsx`:

- Gutschein-Block erscheint und verschwindet als Einheit mit der Zahlungsart.
- Zuzahlung gesperrt mit Begründung, wenn nichts offen ist.
- Zuzahlung aktiv mit Betrag in der Statuszeile, wenn etwas offen ist.
- Warnzustand, solange keine Kassa gewählt ist, ohne das Speichern zu blockieren.
- Kameraflieger gesperrt ohne Video, bedienbar mit Video aus dem Gutschein.
- Löschen fragt nach, ruft `remove` und kehrt zurück; Abbruch löscht nicht.
