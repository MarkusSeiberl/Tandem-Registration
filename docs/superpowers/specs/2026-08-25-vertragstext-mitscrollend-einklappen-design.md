# Vertragstext: bildschirmhoch laden, mit dem Scrollen einklappen

Datum: 2026-08-25

Der Vertragsschirm zeigt den Vertragstext heute in einem Kasten mit
`max-height: 40vh` (`web/guest/src/index.css`). Auf dem Tablet sind das rund
neun Zeilen. Der Gast liest einen mehrseitigen Beförderungsvertrag durch ein
Guckloch, während darunter Datenschutz und Unterschriftsfeld Platz belegen, die
er in diesem Moment noch gar nicht braucht.

Diese Änderung dreht das um:

1. Beim Laden ist der Textkasten so hoch wie der Bildschirm.
2. Erst wenn der Gast den Text zu Ende gescrollt hat, klappt der Kasten beim
   Weiterscrollen mit — Zeile für Zeile, bis auf eine Resthöhe. Datenschutz und
   Unterschrift kommen dabei von unten nach.

Die Leserichtung bleibt eine einzige, durchgehende Bewegung nach unten.

## Beim Laden

Die Höhe wird gemessen, nicht geraten:

```
fullH = Sichthöhe - Oberkante des Textkastens - Höhe des Scroll-Hinweises
```

Damit endet der Kasten genau an der Bildschirmunterkante, und der Hinweis
„Bitte den gesamten Vertrag lesen" bleibt sichtbar. Ihn unter die Falz zu
schieben wäre das Gegenteil dessen, wozu er da ist.

## Das Einklappen

Das Einklappen beginnt **erst**, wenn `scrolledToEnd` gesetzt ist — also wenn
der Gast den Text im Kasten bis zum Ende gescrollt hat. In diesem Moment wird
der aktuelle `scrollY` als Nullpunkt festgehalten.

Danach gilt für jede Scrollposition:

```
h = clamp(minH, fullH - (scrollY - nullpunkt), fullH)
minH = max(35vh, 200px)
```

Nach oben zurückgescrollt wächst der Kasten wieder auf `fullH`. Der Zustand ist
eine reine Funktion der Scrollposition, kein Einwegschalter — ein Gast, der
zurückblättert, bekommt seinen großen Kasten zurück.

`minH` ist bewusst nicht null: Der Vertrag verschwindet nicht, während der Gast
unterschreibt. Was er unterschreibt, bleibt am Schirm.

## Der Platzhalter, ohne den es ruckelt

Schrumpft der Kasten um `S`, wird das Dokument um `S` kürzer — und der maximale
Scrollweg ebenfalls. Der Browser klemmt `scrollY` dann auf das neue Maximum,
und das Einklappen bremst sich selbst aus: Die Seite scrollt, verkürzt sich um
denselben Betrag und rutscht zurück.

Deshalb steht hinter der Karte ein leerer Platzhalter der Höhe `fullH - h`. Was
der Kasten verliert, gewinnt der Platzhalter. Die Dokumenthöhe bleibt konstant,
der Scrollweg auch.

## Aufbau

| Datei | Aufgabe |
| ----- | ------- |
| `web/guest/src/useContractCollapse.ts` (neu) | Misst, hört auf `scroll` und `resize`, liefert `{ height, spacerHeight }`. Kein Markup. |
| `web/guest/src/useContractCollapse.test.ts` (neu) | Prüft die Rechnung gegen gefälschte Maße. |
| `web/guest/src/Contract.tsx` (Änderung) | Refs auf Textkasten und Hinweis, Hook verdrahten, Platzhalter rendern. |
| `web/guest/src/index.css` (Änderung) | `.contract-text` behält `max-height: 40vh` als Rückfall. |

Der Scroll-Listener läuft über `requestAnimationFrame`: Ein `scroll`-Ereignis
feuert auf Android in dichter Folge, und jedes davon würde sonst ein React-Render
auslösen.

## Wenn nicht gemessen werden kann

In jsdom haben alle Elemente die Höhe 0; dasselbe gilt für den Moment, in dem
der Kasten noch nicht im DOM steht. Ergibt die Messung keine brauchbare Höhe,
liefert der Hook `null`, es wird keine Inline-Höhe gesetzt, und die
`max-height: 40vh` aus dem Stylesheet bleibt stehen. Die bestehenden Tests
laufen dadurch unverändert weiter.

## Die Leseschranke bleibt

`scrolledToEnd` steuert weiterhin allein, ob „Weiter" freischaltet, und wird
weiterhin von `handleScroll` im Textkasten gesetzt. Das Einklappen hängt an
dieser Schranke, ändert sie aber nicht. Ein Vertrag, der auch bildschirmhoch
ohne Scrollen hineinpasst, gilt wie bisher sofort als gelesen — dann gibt es
nichts einzuklappen, und `fullH - h` bleibt null.

## Tests

`web/guest/src/useContractCollapse.test.ts` (neu)

- Vor dem Erreichen des Textendes bleibt die Höhe bei `fullH`, auch wenn
  gescrollt wird.
- Nach dem Erreichen des Textendes verkleinert Scrollen die Höhe um genau den
  gescrollten Betrag.
- Die Höhe fällt nie unter `minH`, und `height + spacerHeight` ist konstant
  `fullH`.
- Zurückscrollen stellt `fullH` wieder her.
- Ohne messbare Maße liefert der Hook `null`.

`web/guest/src/Contract.test.tsx` (Erweiterung)

- Der Textkasten bekommt ohne messbare Maße keine Inline-Höhe.

## Was diese Änderung nicht tut

Kein Scroll-Hijacking, keine erzwungene Scroll-Animation, kein Nachbau der
Scroll-Verkettung für Android. Wer im Kasten am Ende angekommen ist, hebt den
Finger einmal und scrollt weiter — so verhalten sich verschachtelte
Scrollbereiche auf dem Gerät ohnehin.
