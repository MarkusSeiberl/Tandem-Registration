# Vertragsschirm: Knöpfe an ihren Platz, fehlende Angaben markiert

Datum: 2026-08-25

Drei Dinge am Vertragsschirm, die den Gast raten lassen.

## 1. „Löschen" stand bei den falschen Knöpfen

„Löschen" saß in der Knopfreihe am Seitenende, zwischen „Abbrechen" und dem
Absenden — also zwischen zwei Knöpfen, die den Schirm verlassen. Dort liest es
sich, als lösche es die Anmeldung.

Es heißt jetzt **„Unterschrift löschen"** und steht rechtsbündig direkt unter
dem Unterschriftsfeld, innerhalb desselben Abschnitts. Solange nichts gezeichnet
ist, ist es abgeschaltet: Es gibt dann nichts zu löschen, und ein Knopf, der
nichts tut, ist ein Knopf, den man ausprobiert.

## 2. Kein Weg zurück zu den Daten

Wer auf dem Vertragsschirm merkt, dass die Telefonnummer falsch ist, konnte nur
„Abbrechen" — zurück zum Startschirm, alle elf Felder noch einmal.

Es gibt jetzt **„Zurück"**, das zum Formular führt, gefüllt mit dem, was der
Gast bereits eingetippt hat.

Die Werte liegen ohnehin schon in `App` (`formValues`); das Formular hat sie
bisher nur nie zurückbekommen. `Form` nimmt darum `initialValues` entgegen und
setzt seinen Anfangszustand daraus. Es rechnet dabei aus den geprüften Werten
wieder Zeichenketten — ein Eingabefeld hält Text, und nur Text lässt eine halb
getippte Zahl halb getippt bleiben.

**Die Unterschrift bleibt nicht erhalten.** Sie gehört zu den Daten, unter denen
sie geleistet wurde, und genau die geht der Gast ändern. Nach der Rückkehr wird
neu unterschrieben.

## 3. Der Absende-Knopf sagte nicht, was fehlt

„Anmeldung abschicken" war abgeschaltet, solange eine der drei Bedingungen
offen war: Vertrag gelesen, Datenschutz bestätigt, unterschrieben. Ein grauer
Knopf sagt aber nur *dass* etwas fehlt, nie *was*. Wer das Häkchen übersehen
hat, sucht am falschen Ende.

Der Knopf ist jetzt **immer drückbar** (außer während des Sendens). Beim Druck
wird geprüft, und was fehlt, wird markiert:

| Fehlt | Markierung |
| ----- | ---------- |
| Vertrag nicht zu Ende gelesen | „Bitte lies zuerst den gesamten Vertrag." über der Knopfreihe; der angeheftete Lesehinweis steht ohnehin schon am unteren Rand |
| Datenschutz nicht bestätigt | Kästchen und Text rot hinterlegt, `aria-invalid`, Meldung darunter, Fokus und Bildlauf auf das Kästchen |
| Nicht unterschrieben | Rahmen des Feldes rot, Meldung darunter, Bildlauf auf den Abschnitt |

Die Markierung erscheint erst nach einem Versuch — vorher ist nichts „falsch",
der Gast ist nur noch nicht fertig. Sie verschwindet, sobald das Fehlende
nachgeholt ist, ohne weiteren Druck auf den Knopf.

**Zur fehlenden Lesestrecke wird nicht gescrollt.** Der Gast dorthin zu bringen
hieße, die Leseschranke für ihn zu öffnen — genau das, was sie verhindern soll.
Bei den anderen beiden wird gescrollt, denn dort ist das Ziel eine Handlung des
Gastes, keine Wegstrecke.

## Aufbau

| Datei | Änderung |
| ----- | -------- |
| `web/guest/src/Contract.tsx` | `onBack`, „Unterschrift löschen" beim Feld, Prüfung beim Absenden, Markierungen |
| `web/guest/src/Form.tsx` | `initialValues`, `toRaw()` |
| `web/guest/src/App.tsx` | reicht `formValues` zurück ins Formular, verdrahtet `onBack` |
| `web/guest/src/index.css` | `.missing-note`, `.privacy-check.missing`, `.signature-pad.missing`, `.sign-actions`, `.btn-small` |
| `web/guest/src/setupTests.ts` | `scrollIntoView`-Attrappe, die jsdom nicht mitbringt |

## Tests

`web/guest/src/Contract.test.tsx`

- Absenden ohne Häkchen: `onNext` bleibt aus, Kästchen ist `aria-invalid`, hat
  den Fokus, Meldung steht da; nach dem Ankreuzen ist die Markierung weg und
  das Absenden geht durch.
- Absenden ohne Unterschrift markiert das Feld.
- „Unterschrift löschen" ist ohne Zeichnung abgeschaltet und hält nach dem
  Löschen das Absenden wieder auf.
- „Zurück" meldet sich nur, wenn es ein Ziel gibt.

`web/guest/src/Form.test.tsx`

- Mit `initialValues` stehen alle Felder gefüllt da und lassen sich sofort
  wieder abschicken.

`tests/e2e/contract-actions.spec.ts` (neu, echter Browser)

- „Zurück" bringt alle elf Werte zurück, eine Korrektur überlebt den nächsten
  Wechsel.
- Absenden ohne Häkchen markiert es, holt es ins Bild und setzt den Fokus.
- „Unterschrift löschen" liegt unter dem Feld und über der Knopfreihe.
