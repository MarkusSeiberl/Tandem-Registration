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
der Gast den Text im Kasten bis zum Ende gescrollt hat. Bis dahin steht die
Seite ohnehin still (siehe „Die Seite steht still"), `scrollY` ist also 0. Damit
ist die Scrollposition selbst der Einklappweg; es gibt keinen Nullpunkt zu
merken — und damit auch keinen, der einen Frame zu spät gemerkt wird.

Für jede Scrollposition gilt:

```
h = clamp(minH, fullH - scrollY, fullH)
minH = max(35vh, 200px)
```

Nach oben zurückgescrollt wächst der Kasten wieder auf `fullH`. Der Zustand ist
eine reine Funktion der Scrollposition, kein Einwegschalter — ein Gast, der
zurückblättert, bekommt seinen großen Kasten zurück.

`minH` ist bewusst nicht null: Der Vertrag verschwindet nicht, während der Gast
unterschreibt. Was er unterschreibt, bleibt am Schirm.

## Die Seite steht still, bis der Vertrag gelesen ist

Der Textkasten scrollt, aber die Seite dahinter scrollt auch. Ein Gast, der
neben dem Kasten wischt oder am Mausrad dreht, fährt damit am Vertrag vorbei
bis zur Unterschrift, ohne dass sich der Text je bewegt hätte. Die Leseschranke
hielte „Weiter" zwar weiterhin zu, aber am Schirm stünde bereits das Ende des
Ablaufs — für jemanden, der noch nichts gelesen hat, das falsche Bild.

`useScrollLock` setzt darum `overflow: hidden` auf `documentElement`, solange
`scrolledToEnd` nicht gesetzt ist. Der Kasten ist dann das einzige, was auf
diesem Schirm scrollt.

Der Haken sitzt in der Aufhebung: Die Schranke öffnet mitten in genau der Wischbewegung,
die gleich die Seite scrollen soll. Wartet die Aufhebung auf den nächsten
React-Render, verschluckt sie den Anfang dieser Bewegung — gemessen im Browser
waren das rund acht Frames und 240 der ersten 300 Pixel. `useScrollLock` gibt
deshalb ein `release()` zurück, das `Contract.handleScroll` in demselben
Ereignis aufruft, in dem die Schranke fällt.

## Der Finger, der nicht absetzen muss

Eine Berührung gehört für ihre gesamte Dauer einem einzigen Scrollbereich: Ist
der Text am Ende, gibt der Browser den Rest des Wischers nicht an die Seite
weiter. Der Gast müsste absetzen und neu ansetzen — ausgerechnet an der Stelle,
an der die Bewegung durchgehen soll.

`useTouchScrollChain` reicht den Rest von Hand weiter. Liegt der Kasten an
seinem Ende, scrollt jeder weitere Pixel Zug nach oben das Fenster statt den
Kasten. In die Gegenrichtung gilt dasselbe spiegelbildlich: Solange die Seite
noch eingeklappt ist, macht ein Zug nach unten zuerst das Einklappen rückgängig
und erst danach den Text.

`preventDefault()` ist dabei nur der Versuch wert, den es kostet: Chrome
markiert `touchmove` als nicht mehr abbrechbar, sobald eine Scrollgeste läuft.
Das schadet nicht — der Kasten hat an dieser Stelle nichts mehr zu scrollen,
es gibt also kein zweites Scrollen zu unterdrücken.

Für Mausrad und Trackpad braucht es nichts davon: Die Verkettung zwischen
verschachtelten Scrollbereichen funktioniert dort von selbst. Deshalb bekommt
`.contract-text` auch kein `overscroll-behavior: contain` — das würde genau
diese Verkettung abschalten.

## Der Kasten bleibt am Ende des Textes

Schrumpft ein Scrollbereich, bleibt sein `scrollTop` stehen. Das Ende des
Textes rutscht damit aus dem Sichtfenster: Der Vertrag liefe beim Einklappen
rückwärts, und der Kasten wäre nicht mehr „am Ende" — die Weitergabe an die
Seite bräche nach zwei Fingerbreit ab. `useContractCollapse` setzt darum bei
jedem Schritt `scrollTop = scrollHeight`. Die letzte Zeile bleibt die letzte
Zeile.

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
| `web/guest/src/useContractCollapse.ts` (neu) | Misst, hört auf `scroll` und `resize`, liefert `{ height, spacerHeight }`, hält den Kasten am Textende. Kein Markup. |
| `web/guest/src/useContractCollapse.test.ts` (neu) | Prüft die Rechnung gegen gefälschte Maße. |
| `web/guest/src/useScrollLock.ts` (neu) | Hält die Seite still, solange gesperrt; gibt ein sofortiges `release()` zurück. |
| `web/guest/src/useTouchScrollChain.ts` (neu) | Reicht den Rest eines Wischers vom Kasten an die Seite weiter. |
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

`web/guest/src/useScrollLock.test.ts` (neu)

- Sperrt, entsperrt, stellt den vorherigen Wert wieder her, räumt beim
  Abbau auf.
- `release()` hebt die Sperre ohne Render auf.

`web/guest/src/useTouchScrollChain.test.ts` (neu)

- Am Textende wandert der Zug an die Seite, davor nicht.
- Rückwärts wird zuerst die Seite zurückgeholt, dann der Text.
- Die Geste wird über mehrere Schritte verfolgt und am Ende vergessen.

`tests/e2e/contract-scroll.spec.ts` (neu, echter Browser)

- Vor dem Lesen bewegt weder Mausrad noch Wischen neben dem Kasten die Seite.
- Nach dem Lesen trägt das Mausrad über dem Kasten in das Einklappen hinein.
- Ein einziger Finger liest zu Ende und klappt weiter ein, ohne abzusetzen:
  zehn Schritte à 30 px ergeben 300 px Seitenscroll und 300 px weniger Kasten.

## Was diese Änderung nicht tut

Kein Scroll-Hijacking, keine erzwungene Scroll-Animation, kein Nachbau der
Scroll-Verkettung für Android. Wer im Kasten am Ende angekommen ist, hebt den
Finger einmal und scrollt weiter — so verhalten sich verschachtelte
Scrollbereiche auf dem Gerät ohnehin.
