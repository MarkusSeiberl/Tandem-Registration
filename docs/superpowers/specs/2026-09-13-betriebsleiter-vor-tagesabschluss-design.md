# Betriebsleiter vor dem Tagesabschluss

## Problem

Der Tagesabschluss schreibt eine Zeile `Betriebsleiter (BL)` in das Blatt
(`src/server/routes/export.ts:150`). Ihr Wert kommt aus `day_manager` für den
Tag — und der ist leer, solange niemand das Feld in der Toolbar ausgefüllt hat.

Heute merkt das niemand. `handleExport()` in `web/manifest/src/List.tsx` prüft
nur zwei Dinge: ob noch Tandems offen sind und ob eines keine Zahlungsart hat.
Ist der Tag sauber, exportiert der Druck sofort — mit leerer BL-Zeile. Das
Blatt ist dann formal unvollständig und fällt erst im Verein auf, wo es keinen
mehr gibt, der sagen könnte, wer den Tag geführt hat.

## Lösung

Der fehlende Betriebsleiter wird ein dritter Grund, aus dem das vorhandene
Warn-Panel aufgeht — und das Panel bekommt das Feld gleich mit, damit der
Operator den Namen dort eintippen kann, statt in die Toolbar zurückzuspringen.

```
┌ Tagesabschluss ────────────────────────────────────┐
│ Kein Betriebsleiter eingetragen.                   │
│ Die BL-Zeile im Blatt bliebe leer.                 │
│                                                    │
│ Betriebsleiter [Max Muster_______]                 │
│                                                    │
│ [Exportieren]  [Abbrechen]                         │
└────────────────────────────────────────────────────┘
```

Keine harte Sperre: „Trotzdem exportieren" bleibt möglich. Ein Tag, den niemand
mehr zuordnen kann, ist ein Fehler, aber keiner, den die Software dem Operator
um 19 Uhr am Landeplatz verbieten soll.

## Ein Feld, ein State

Das Feld im Panel und das Feld in der Toolbar sind **dasselbe** `manager`-State
in `List.tsx` — `value={manager} onChange={(e) => setManager(e.target.value)}`,
genau wie die Toolbar es schon macht. Damit steht der im Panel getippte Name
sofort auch oben in der Toolbar; es gibt keinen Kopierschritt und keine zweite
Wahrheit, die auseinanderlaufen könnte.

Gespeichert wird er durch das vorhandene `saveManager()`, das `runExport()`
ohnehin als Erstes aufruft:

```ts
async function runExport() {
  ...
  if (!(await saveManager())) return
```

`saveManager()` schreibt nur, wenn sich der Name gegenüber `savedManager.current`
geändert hat, und bricht den Export ab, wenn das Schreiben fehlschlägt. Beides
gilt damit unverändert auch für den im Panel getippten Namen. Der `onBlur` der
Toolbar bleibt, wie er ist; das Panel braucht keinen eigenen.

## Schnappschuss und lebende Texte

`ExportWarning` hält heute die Zahlen des Augenblicks, in dem gedrückt wurde,
damit das Panel nicht unter der Hand seine Aussage ändert, wenn ein anderes
Tablet eine Zeile anlegt. Der Betriebsleiter ist anders: ihn ändert der Operator
**im Panel**, und das Panel muss darauf antworten.

Deshalb zwei getrennte Dinge:

| | Quelle | ändert sich im offenen Panel |
| --- | --- | --- |
| Steht das Feld im Panel? | `ExportWarning.noManager` (Schnappschuss) | nein |
| Warnsatz + Button-Beschriftung | `manager.trim() === ''` (live) | ja |

Das Feld bleibt also stehen, sobald das Panel deswegen aufging — es springt
nicht beim ersten Buchstaben weg und nimmt dem Finger das Ziel. Der Warnsatz
„Kein Betriebsleiter eingetragen. Die BL-Zeile im Blatt bliebe leer."
verschwindet dagegen, sobald etwas im Feld steht; er wäre sonst nachweislich
falsch.

Ebenso die Beschriftung des Export-Buttons:

- `manager.trim() === ''` → `Trotzdem exportieren` (wie heute)
- sonst → `Exportieren`

Ein Druck auf einen Button, der „trotzdem" sagt, während oben ein Name steht,
würde eine Warnung behaupten, die es nicht mehr gibt.

## Was sich sonst nicht ändert

- **Server.** Keine Änderung. `export.ts` schreibt weiter, was in `day_manager`
  steht; der leere Name bleibt erlaubt, weil der Override ihn erlaubt.
- **„Alle kassieren und exportieren".** Endet in `runExport()` und nimmt den
  Namen damit automatisch mit. Der Button steht wie bisher nur da, wenn es
  etwas zu kassieren gibt.
- **Die vorhandenen Warnsätze** (`warningCounts`, `warningExplanation`) bleiben
  unangetastet. Der Betriebsleiter ist kein Zustand der Zeilen und gehört nicht
  in ihre Zählung — er bekommt seinen eigenen Absatz über dem Feld.
- **Ist der Tag sauber und der Name gesetzt**, exportiert der Druck weiterhin
  sofort, ohne Panel.

## Tests

`web/manifest/src/List.test.tsx`, im Block `Export-Warnung`:

1. Sauberer Tag, leerer Betriebsleiter → Panel geht auf, `exportDay` wurde
   nicht gerufen.
2. Sauberer Tag, Betriebsleiter gesetzt → exportiert sofort, kein Panel.
3. Im Panel getippter Name steht auch im Toolbar-Feld.
4. Export aus dem Panel ruft `saveDayManager` mit dem getippten Namen und
   danach `exportDay`.
5. Button heißt `Trotzdem exportieren`, solange das Feld leer ist, und
   `Exportieren`, sobald etwas darin steht.
6. Leer gelassen exportiert weiter (Override bleibt).

Die bestehenden Tests des Blocks mocken `api.dayManager` mit `{ name: '' }`;
die, die einen Sofort-Export oder ein Panel ohne BL-Absatz behaupten, bekommen
einen Namen, damit sie weiter das prüfen, wofür sie geschrieben wurden.
