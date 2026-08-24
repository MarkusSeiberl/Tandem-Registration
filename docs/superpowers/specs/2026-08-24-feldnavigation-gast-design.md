# Feldnavigation im Gast-Formular

Datum: 2026-08-24

Das Gast-Formular hat elf Pflichtfelder. Ausgefüllt wird es auf einem Tablet,
das dem Gast in die Hand gedrückt wird — mit Bildschirmtastatur, ohne Maus, ohne
Tab-Taste. Um von einem Feld zum nächsten zu kommen, muss der Gast heute jedes
Mal die Tastatur wegschieben, das nächste Feld antippen und die Tastatur wieder
aufklappen lassen. Elf Mal.

Diese Änderung gibt dem Formular zwei Wege von Feld zu Feld:

1. **Die Eingabetaste** springt zum nächsten Feld statt das Formular
   abzuschicken.
2. **Zwei Pfeilschaltflächen**, die dauerhaft sichtbar über der Tastatur
   stehen.

Beide Wege bewegen denselben Cursor durch dieselbe Reihenfolge. Der eine ersetzt
den anderen nicht — sie decken einander ab.

## Warum beides und nicht nur die Eingabetaste

Vier Felder — Alter, Größe, Gewicht, PLZ — tragen `inputMode="numeric"` und
öffnen darum den Ziffernblock. Ob dieser Ziffernblock überhaupt eine
Eingabetaste anbietet, entscheidet die Tastatur-App des Tablets, nicht das
Formular. Gboard tut es in der Regel, andere nicht. Auf einer Tastatur ohne
Eingabetaste liefe die Kette an vier von elf Feldern ins Leere.

Das Geschlecht ist zudem kein Textfeld, sondern eine Radiogruppe. Dort löst die
Eingabetaste ohnehin nichts aus. Die Kette bräche also am dritten Feld auf
jedem Gerät.

Die Schaltflächen sind darum kein Komfort obendrauf, sondern der verlässliche
Weg; die Eingabetaste ist die Abkürzung für alle, deren Tastatur sie hergibt.

## Die Reihenfolge

Elf Stationen, das Geschlecht zählt als eine:

```
firstName -> lastName -> gender -> age -> height -> weight
          -> street -> postalCode -> city -> email -> phone
```

Das ist exakt die Reihenfolge, in der die Felder im Formular stehen. Die Kette
wird an einer Stelle definiert und nicht aus dem DOM erraten — sonst geht sie
beim nächsten Umbau des Layouts still kaputt.

## Aufbau

Drei Teile, jeder für sich prüfbar:

| Datei | Aufgabe |
| ----- | ------- |
| `web/guest/src/useFieldChain.ts` (neu) | Kennt die Reihenfolge und den aktuellen Index, bietet `next()`, `prev()`, `focusFirstError()`. Kein Markup. |
| `web/guest/src/FieldNav.tsx` (neu) | Die Pfeilleiste. Nimmt `canPrev`, `canNext`, `onPrev`, `onNext` entgegen, hält keinen eigenen Zustand. |
| `web/guest/src/Form.tsx` (Änderung) | Verbindet beides: Refs an den Feldern, `onKeyDown`, `enterKeyHint`. |

`useViewportHeight.ts` und der zugehörige Test werden aus dem Tag
`archive/guest-tablet-redesign` übernommen, unverändert. Der Hook löst das
Tastaturproblem weiter unten und ist auf genau diesem Tablet bereits erprobt.

### Der Zustand des aktuellen Feldes

`useFieldChain` führt den Index selbst, gespeist aus `onFocus` der Felder. Damit
stimmt der Index auch dann, wenn der Gast ein Feld direkt antippt statt sich
durchzuhangeln — die Pfeile setzen dann von dort aus fort und nicht von der
Stelle, an der zuletzt ein Pfeil gedrückt wurde.

## Verhalten

**Eingabetaste** in einem Textfeld: `preventDefault()`, dann weiter zum nächsten
Feld. Das `preventDefault()` ist nötig, weil ein `<form>` mit genau einem
Absende-Knopf sonst abschickt.

**`enterKeyHint`**: `"next"` auf allen Feldern außer dem letzten, `"done"` auf
`phone`. Damit beschriftet Android die Taste passend, bevor der Gast sie das
erste Mal drückt.

**Geschlecht**: Der Fokus landet auf dem gewählten Radio, oder auf dem ersten,
wenn noch nichts gewählt ist. Innerhalb der Gruppe wählen die Pfeiltasten wie
gewohnt aus; der nächste Sprung führt zu `age`.

**Am Ende der Kette** — Eingabetaste auf `phone`:

- Ist das Formular vollständig gültig, wird abgeschickt. Das ist derselbe Weg,
  den heute der Knopf „Weiter" nimmt.
- Ist es das nicht, springt der Fokus auf das erste fehlerhafte Feld, und
  dessen Fehlermeldung wird sichtbar. Dazu wird `touched` für alle Felder
  gesetzt, genau wie `handleSubmit()` es schon tut.

**An den Rändern** schalten sich die Pfeile ab: `^` bei `firstName`, `v` bei
`phone`. Es wird nicht umlaufend gescrollt — ein Gast, der im Kreis läuft,
findet den Absende-Knopf nicht.

## Die Leiste

Zwei Schaltflächen, nur Pfeile, ohne Text:

```
+-----------------------------------+
|  [ ^ ]  [ v ]                     |
+-----------------------------------+
```

Beschriftet werden sie für Screenreader über `aria-label`: „Vorheriges Feld"
und „Nächstes Feld".

Bewusst kein Text im Knopf: Der Absende-Knopf am Formularende heißt bereits
„Weiter" und meint etwas anderes — nämlich den Wechsel zum Vertragsschirm. Zwei
Knöpfe mit derselben Aufschrift und verschiedener Wirkung auf einem Schirm wären
eine Falle. Der Absende-Knopf behält seine Aufschrift und seinen Platz.

### Der Griff, auf den es ankommt

Die Knöpfe reagieren auf `onPointerDown` mit `preventDefault()`, nicht auf
`onClick`.

Ein normaler Tipp auf eine Schaltfläche nimmt dem Eingabefeld den Fokus. Android
fährt daraufhin die Tastatur ein — und zwar bevor der Klick-Handler den Fokus
auf das nächste Feld setzen kann. Die Tastatur klappt also bei jedem Sprung zu
und wieder auf. `preventDefault()` auf `pointerdown` unterbindet den
Fokusverlust; der Fokus wird anschließend direkt weitergesetzt und die Tastatur
bleibt oben.

Ohne dieses Detail löst die Leiste das Problem nicht, das sie lösen soll.

## Die Tastatur verdeckt die Leiste

Das Formular auf `main` scrollt als gewöhnliche Seite; `.actions` steht im
normalen Fluss (`index.css:209`), nichts ist angeheftet. Eine Leiste mit
`position: fixed; bottom: 0` läge damit unter der Bildschirmtastatur — also
genau dort, wo sie nichts nützt.

Der Grund: Die Android-Tastatur verkleinert das *visuelle* Viewport, nicht das
Layout-Viewport. `bottom: 0` meint weiterhin den unteren Rand der ganzen Seite.

`useViewportHeight` liest `window.visualViewport` und meldet die tatsächlich
sichtbare Höhe. Die Leiste wird daran ausgerichtet und bleibt so über der
Tastatur stehen. Fehlt `visualViewport` — ältere Browser, Testumgebung —, fällt
der Hook auf `window.innerHeight` zurück; die Leiste sitzt dann unten am
Seitenrand, was ohne Bildschirmtastatur richtig ist.

## Tests

`web/guest/src/useFieldChain.test.ts` (neu)

- Die Reihenfolge stimmt und enthält alle elf Stationen.
- `next()` am letzten und `prev()` am ersten Feld laufen nicht über.
- `focusFirstError()` findet das erste fehlerhafte Feld in Ketten-Reihenfolge,
  nicht in Fehler-Reihenfolge.

`web/guest/src/Form.test.tsx` (Erweiterung)

- Eingabetaste in `firstName` setzt den Fokus auf `lastName` und schickt nicht ab.
- Die Pfeilknöpfe bewegen den Fokus in beide Richtungen.
- `^` ist bei `firstName` deaktiviert, `v` bei `phone`.
- Eingabetaste auf `phone` schickt bei gültigem Formular ab.
- Eingabetaste auf `phone` springt bei ungültigem Formular auf das erste
  fehlerhafte Feld und zeigt dessen Meldung.
- Der Sprung über das Geschlecht landet auf einem Radio der Gruppe.

`tests/e2e/flow.spec.ts` (Erweiterung)

- Ein Durchlauf, der alle elf Felder allein über die Eingabetaste füllt und am
  Ende auf dem Vertragsschirm landet.

## Was diese Änderung nicht tut

Das Layout des Formulars bleibt, wie es ist. Aus dem verworfenen Redesign wird
nur `useViewportHeight` übernommen, nichts sonst — kein Zweispalter, keine
angehefteten Aktionen, keine Fortschrittspunkte.
