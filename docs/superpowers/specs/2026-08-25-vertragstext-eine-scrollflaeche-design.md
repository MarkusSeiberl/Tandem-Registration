# Vertragsschirm: eine einzige Scrollfläche

Datum: 2026-08-25

Der Vertragsschirm hatte zwei Scrollbereiche: den Textkasten und die Seite
dahinter. Aus dieser Verschachtelung kamen beide Beschwerden vom Gerät:

1. Ein Wischer **neben** dem Kasten scrollte die Seite am Vertrag vorbei bis zur
   Unterschrift, ohne dass sich der Text je bewegt hätte.
2. War der Text zu Ende, **starb der Wischer am Rand des Kastens**. Der Gast
   musste absetzen und neu ansetzen — genau dort, wo die Bewegung durchlaufen
   sollte.

Beides ließ sich einzeln reparieren (Seite sperren, Restweg von Hand
weiterreichen), und genau das fühlte sich dann falsch an: eine tote Seite, die
auf keinen Zug reagiert, und danach ein Seitenscroll ohne Schwung, direkt nach
einem Textscroll mit Schwung.

Diese Änderung nimmt stattdessen die Ursache weg: **Der Schirm hat nur noch
eine Scrollfläche — die Seite.**

## Was sich ändert

Der Vertragstext ist kein eigener Scrollbereich mehr. Er liegt in voller Länge
in der Karte, und die Seite scrollt ihn wie jeden anderen langen Text. Damit:

- gibt es nur eine Physik, mit Schwung, wie der Browser sie liefert;
- gibt es keinen Rand, an dem eine Geste endet;
- braucht es keine Seitensperre — an der Unterschrift vorbeizuscrollen ist
  unmöglich, weil der Weg dorthin durch den Vertrag führt;
- entfallen `useContractCollapse`, der Platzhalter, das Einklappen, die Sperre
  und die Gestenweitergabe ersatzlos.

Beim Laden füllt der Text den Schirm — nicht, weil eine Höhe gemessen wird,
sondern weil ein mehrseitiger Vertrag länger ist als jeder Bildschirm.

## Die Leseschranke

Am Ende des Textes steht ein Marker (`.contract-end`). `useReachedEnd` prüft
seine Position und öffnet die Schranke, sobald er über dem unteren Rand steht —
72 px davon gehören dem Lesehinweis, Text dahinter gilt nicht als gelesen.

**Kein IntersectionObserver.** Ein Observer meldet nur das Überschreiten einer
Schwelle. Ein Schwung, der den Marker zwischen zwei Frames von unterhalb des
Schirms nach oberhalb wirft, überschreitet nichts, was er sehen kann — die
Schranke bliebe bei einem Gast zu, der komplett durchgescrollt hat. Genau das
ist im Browsertest passiert. Die Frage „steht das Ende auf oder über der
Falz?" beantwortet sich gleich, ob langsam vorbeigescrollt oder in einem Wurf.

Einmal offen, bleibt die Schranke offen: Wer zum Nachlesen zurückscrollt, hat
den Vertrag trotzdem gelesen.

Ein Vertrag, der auf den Schirm passt, hat seinen Marker von Anfang an im Bild
und gilt sofort als gelesen — dieselbe Regel wie bisher, auf einfacherem Weg.

## Der Lesehinweis

Der Hinweis „Bitte den gesamten Vertrag lesen" hängt jetzt am unteren
Bildschirmrand statt unter dem Text. Unter einem vollständigen Vertrag stünde er
einen halben Meter Scrollweg von dem Gast entfernt, der ihn braucht.

## Der Knopf heißt jetzt, was er tut

„Weiter" auf dem Vertragsschirm schickt die Anmeldung ab — es kommt kein
weiterer Schirm, auf dem sich das noch abbrechen ließe. Er heißt deshalb
**„Anmeldung abschicken"**. Auf dem Formularschirm bleibt „Weiter" stehen, denn
dort stimmt es.

## Aufbau

| Datei | Aufgabe |
| ----- | ------- |
| `web/guest/src/useReachedEnd.ts` (neu) | Leseschranke: prüft die Position des Endmarkers bei jedem Scroll-Frame. |
| `web/guest/src/useReachedEnd.test.ts` (neu) | Deckt den Wurf ab, den ein Observer verpasst hätte. |
| `web/guest/src/Contract.tsx` | Kein eigener Scrollbereich, Endmarker, angehefteter Hinweis, neuer Knopftext. |
| `web/guest/src/index.css` | `.contract-text` ohne `overflow`/`max-height`, `.scroll-hint` am Rand fixiert. |
| `web/guest/src/useContractCollapse.*` | Entfällt. |

## Tests

`web/guest/src/useReachedEnd.test.ts` (neu)

- Zu, solange das Ende unter dem Schirm oder hinter dem Hinweis steht.
- Offen, sobald es frei steht — auch bei einem Sprung in einem einzigen Frame.
- Offen von Anfang an bei kurzem Vertrag; bleibt offen beim Zurückscrollen.
- Misst nichts mehr, sobald die Schranke offen ist.

`tests/e2e/contract-scroll.spec.ts` (neu, echter Browser)

- Der Text hat keinen eigenen Scrollbereich und ist höher als der Schirm.
- Der Hinweis bleibt beim Scrollen sichtbar.
- Die Unterschrift liegt hinter dem Endmarker und ist vorher nicht im Bild.
- Sechs Radschritte hintereinander bewegen die Seite jedes Mal weiter — kein
  Schritt versickert.
