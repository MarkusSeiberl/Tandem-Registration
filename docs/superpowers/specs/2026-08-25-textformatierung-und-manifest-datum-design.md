# Fetter Text in den Einstellungen, und ein Manifest, das sein Datum behält

Datum: 2026-08-25

Zwei Dinge im Manifest.

## 1. Der Vertragstext zeigte seine Auszeichnung nicht

Auf dem Tablet stehen vier Passagen des Beförderungsvertrags fett — so wie auf
dem Papiervertrag des Vereins. Zustande kam das über eine **fest eingebaute
Liste** dieser vier Textstellen in der Gast-App: Was dort wörtlich vorkam, wurde
fett gezeichnet. In den Einstellungen war davon nichts zu sehen, und der Verein
konnte nichts anderes fett setzen — wer eine neue Passage hervorheben wollte,
brauchte einen neuen Build.

Der Text trägt seine Auszeichnung jetzt selbst:

```
**Absprung:** Hohlkreuz mit Becken nach vorne ...
```

Ein Marker, eine Bedeutung. **Bewusst kein Markdown**: Das hier ist Rechtsprosa,
die jemand in ein Textfeld tippt oder aus einer Anwaltsmail einfügt, und dort
ist ein Unterstrich ein Unterstrich und eine Raute eine Raute. Ein `**` ohne
Partner bleibt sichtbar stehen, statt still verschluckt zu werden — sichtbar
heißt reparierbar.

### Der Editor

Weiterhin ein Textfeld, kein `contenteditable`. Cursor, Rückgängig, Einfügen und
Auswahl funktionieren dort von selbst; ein selbstgebautes Rich-Feld müsste jedes
davon nachbauen. Gefehlt hat nie das Tippen, sondern das Sehen. Also:

- ein Knopf **„Fett"** (und Strg+B), der die Auswahl in `**` setzt — oder sie
  wieder herausnimmt, auch wenn die Auswahl innerhalb der Sternchen liegt;
- darunter eine **Vorschau**, gezeichnet mit demselben Renderer, den die
  Gast-App verwendet.

Nach dem Knopfdruck wird die Auswahl wiederhergestellt: Ein Editor, der bei
jedem Klick den Cursor verliert, wird nicht benutzt.

Beides gilt für den Vertragstext **und** den Datenschutztext.

### Alte config.json

`withBoldMarkers()` setzt beim Laden die Marker um die vier bekannten Passagen,
wenn der gespeicherte Text noch gar keine Marker hat. Enthält er schon welche,
bleibt er unangetastet — ab dann sind die Marker die ganze Wahrheit, auch für
einen Verein, der eine dieser Stellen absichtlich nicht mehr fett haben will.

**Nichts wird dabei auf die Platte zurückgeschrieben.** Der migrierte Text ist
das, was die Einstellungen laden und beim nächsten „Speichern" mitschreiben.
Eine fremde Konfigurationsdatei beim Start umzuschreiben, nur um Formatierung
geradezuziehen, wäre eine Überraschung ohne Verhältnis zum Anlass.

Der Datenschutztext wird nicht migriert: Dort gab es nie eine eingebaute Liste.

### Zwei Kopien des Renderers

`richText.tsx` liegt in beiden Web-Apps, wie `labels.ts` es vorgemacht hat — die
Projekte teilen kein Paket. Beide Dateien tragen einen Verweis aufeinander:
Weichen sie voneinander ab, zeigt die Vorschau etwas anderes als das Tablet, und
genau das soll sie nicht.

## 2. Das Manifest vergaß das gewählte Datum

Das Datum lebte in `List`. Jeder Wechsel zu Stammdaten, Einstellungen oder in
eine Registrierung baut `List` ab — beim Zurückkommen stand wieder „heute" da.
Wer den gestrigen Tag abarbeitete, hat das Datum den ganzen Nachmittag neu
gesetzt.

Es liegt jetzt in `App` und überlebt damit jeden Wechsel; zusätzlich merkt sich
`sessionStorage` den Tag, sodass auch ein Neuladen des Fensters ihn behält.

**Session, nicht `localStorage`:** Ein am nächsten Morgen frisch geöffnetes
Manifest soll auf diesem Morgen stehen, nicht auf dem zuletzt angesehenen Tag.

Daneben steht ein Knopf **„Heute"**, der auf den laufenden Tag zurückspringt und
abgeschaltet ist, solange er nichts ändern würde.

## Aufbau

| Datei | Änderung |
| ----- | -------- |
| `web/guest/src/richText.tsx` (neu) | `renderRichText()` — `**fett**` zu `<strong>` |
| `web/manifest/src/richText.tsx` (neu) | dasselbe, dazu `toggleBold()` für den Knopf |
| `web/manifest/src/Settings.tsx` | `TextEditor` mit Fett-Knopf, Strg+B und Vorschau |
| `web/guest/src/Contract.tsx` | zeichnet mit `renderRichText`; die eingebaute Phrasenliste entfällt |
| `src/server/config.ts` | Marker im Standardtext, `withBoldMarkers()` beim Laden |
| `web/manifest/src/date.ts` | `storedDate()`, `rememberDate()` |
| `web/manifest/src/App.tsx` | hält das Datum, reicht es an `List` |
| `web/manifest/src/List.tsx` | Datum als Prop, Knopf „Heute" |

## Tests

- `richText.test.tsx` (beide Apps): fett zwischen Markern, über Zeilenumbrüche
  hinweg, einzelner Marker bleibt stehen, leeres Paar bleibt stehen.
- `toggleBold`: setzen, entfernen, entfernen bei Auswahl innerhalb der
  Sternchen, leeres Paar mit Cursor dazwischen.
- `tests/config.test.ts`: Standardtext trägt die Marker; alte config.json
  bekommt sie beim Laden; ein Text mit Markern bleibt unberührt; der
  Datenschutztext wird nicht angefasst.
- `Settings.test.tsx`: Vorschau zeigt `<strong>`, der Fett-Knopf schreibt die
  Marker in den Text.
- `App.test.tsx` (neu): Start auf heute, Tag überlebt Tabwechsel und
  Neuaufbau, „Heute" springt zurück.
- `List.test.tsx`: zeigt den übergebenen Tag, „Heute" nur aktiv wenn es etwas
  ändert.
- `tests/e2e/manifest-texts-and-date.spec.ts` (neu): Vorschau mit vier fetten
  Passagen und ohne Sternchen, Fett-Knopf im echten Browser, der Gast liest die
  fetten Stellen statt der Marker, und das Datum übersteht Tabwechsel wie
  Neuladen.
