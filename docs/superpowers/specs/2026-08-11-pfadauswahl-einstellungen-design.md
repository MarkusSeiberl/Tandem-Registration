# Pfadauswahl im Einstellungen-Screen

Datum: 2026-08-11

Drei Felder im Einstellungen-Screen zeigen auf das Dateisystem: das
Export-Verzeichnis, das Backup-Verzeichnis und die Gutscheinliste. Alle drei sind
heute reine Textfelder. Wer sie ausfüllt, muss den vollständigen Pfad abtippen
oder aus dem Explorer kopieren — und ein Tippfehler fällt erst auf, wenn ein
Export oder ein Backup fehlschlägt.

Diese Änderung stellt neben jedes der drei Felder eine Schaltfläche
„Durchsuchen…", die den gewohnten Windows-Dialog öffnet. Die Textfelder bleiben
bearbeitbar; die Auswahl ist eine Bequemlichkeit, kein Ersatz.

`jumpLocation` bleibt unberührt — das ist ein Ortsname, kein Pfad.

## Warum kein Dialog im Browser

Das Manifest ist eine Web-Oberfläche, der Server ein eigenes Programm. Die Pfade
in der Konfiguration meinen immer das Dateisystem **des Server-Rechners**. Ein
`<input type="file">` im Browser liefert dagegen Dateien des *anzeigenden*
Geräts, und aus Sicherheitsgründen ohne vollständigen Pfad. Es würde also selbst
dann das Falsche liefern, wenn Browser und Server auf demselben Rechner laufen.

Die Auswahl muss deshalb vom Server ausgelöst werden: er öffnet den Dialog auf
seinem eigenen Desktop und schickt den gewählten Pfad zurück.

Das setzt voraus, dass die Person, die auf „Durchsuchen…" klickt, vor genau
diesem Rechner sitzt. Für die Einstellungen trifft das zu — sie werden am
Rechner mit `tandem.exe` gepflegt, nicht am Tablet. Ein Klick vom Tablet aus
würde einen Dialog öffnen, den niemand sieht, und die Anfrage hängen lassen.
Darum gibt es die Schaltfläche für entfernte Geräte gar nicht erst.

## Server: die Auswahl

Neue optionale Abhängigkeit in `buildServer(...)`, in derselben Form wie `notify`:

```ts
type PickKind = 'directory' | 'excel-file'
type PickPath = (kind: PickKind, current: string) => Promise<string | null>
```

`src/server/routes/pickPath.ts` registriert zwei Routen:

| Route | Antwort |
| ----- | ------- |
| `GET /api/pick-path` | `{ available: boolean }` |
| `POST /api/pick-path` mit `{ kind, current }` | `{ path: string \| null }` |

`available` ist nur dann `true`, wenn eine Auswahlfunktion injiziert wurde **und**
die Anfrage von der Loopback-Adresse kommt (`127.0.0.1`, `::1`,
`::ffff:127.0.0.1`). `POST` prüft dasselbe noch einmal: von außerhalb `403`, ohne
injizierte Funktion `503`, bei unbekanntem `kind` `400`. Ein `null` in `path`
heißt: abgebrochen.

Die Prüfung gehört auf den Server, nicht in die Oberfläche. Das Manifest kennt
die versteckte Einstellung `apiBase` und kann auf einen anderen Rechner zeigen —
„läuft im Browser auf localhost" heißt dann gerade nicht „redet mit dem eigenen
Rechner". Nur der Server weiß, wer ihn anspricht.

Nebenbei ist damit auch die offensichtliche Frage beantwortet, warum ein Server,
der auf `0.0.0.0` lauscht, keinen Dialog für Fremde öffnet: die Route ist auf
Loopback beschränkt.

## Server: der Windows-Dialog

`src/server/pickPathWin.ts` enthält die eigentliche Umsetzung. Sie wird
ausschließlich in `main.ts` verdrahtet, und dort nur bei
`process.platform === 'win32'`. Auf jedem anderen System — und in jedem Test, der
`buildServer` direkt aufruft — gibt es keine Auswahlfunktion, also keine
Schaltfläche.

Der Dialog läuft als `powershell.exe` mit `-NoProfile -STA -ExecutionPolicy
Bypass -EncodedCommand <base64-UTF16LE>`. `-EncodedCommand` statt `-Command`,
weil sonst jedes Anführungszeichen und jeder Umlaut in einem Pfad zu einer Frage
der Zitierung wird.

Das Skript öffnet je nach `kind` einen `FolderBrowserDialog` oder einen
`OpenFileDialog` mit dem Filter `Excel-Dateien (*.xlsx;*.xlsm)`, vorbelegt mit dem
aktuellen Wert, sofern es ihn noch gibt. Es zeigt den Dialog mit einem
Besitzerfenster, das `TopMost` gesetzt hat: sonst kann der Dialog hinter dem
Konsolenfenster von `tandem.exe` erscheinen, und der Bediener sieht ein Programm,
das scheinbar hängt. Auf stdout landet der gewählte Pfad, bei Abbruch nichts.

Nach zehn Minuten wird der Kindprozess beendet. Das ist keine Zeitgrenze für die
Bedienung, sondern eine Sicherung gegen einen vergessenen Dialog, der sonst
zusammen mit der offenen Anfrage bis zum Neustart stehen bliebe.

## Server: die Pfadprüfung

`POST /api/paths/check` nimmt `{ exportDir?, backupDir?, voucherListPath? }` und
antwortet je Schlüssel mit `'ok' | 'missing' | 'wrong-type'`. Ein leerer String
ist `'ok'` — sowohl `backupDir` (leer = Export-Verzeichnis) als auch
`voucherListPath` (leer = keine Gutscheinprüfung) sind zulässig leer.

Gespeichert wird weiterhin alles. Ein Pfad kann auf ein Netzlaufwerk oder einen
USB-Stick zeigen, der gerade nicht angeschlossen ist; wer ihn im Winter
vorbereitet, darf daran nicht scheitern. Die Prüfung warnt, sie blockiert nicht.

Die Warnungen kommen bewusst über eine eigene Route und nicht im Rückgabewert von
`PUT /api/settings`. Dieser Handler schreibt den gesamten Anfragekörper per Spread
nach `cfgRef.current` und persistiert ihn — ein zusätzliches Feld in der Antwort
würde die Oberfläche beim nächsten Speichern zurückschicken und landete in
`config.json`. `PUT /api/settings` bleibt unverändert.

## Oberfläche

`web/manifest/src/api.ts` bekommt `pickerAvailable()`, `pickPath(kind, current)`
und `checkPaths(fields)`.

In `Settings.tsx` werden die drei Pfadfelder zu einer Zeile aus Eingabefeld und
Schaltfläche „Durchsuchen…". Die Verfügbarkeit wird einmal beim Laden abgefragt;
schlägt die Abfrage fehl oder meldet `false`, erscheint die Schaltfläche nicht,
und der Screen sieht aus wie heute. Ein Klick ruft `pickPath` auf: kommt ein Pfad
zurück, wird das Feld gesetzt und der Hinweis „Gespeichert" zurückgenommen; kommt
`null`, bleibt alles stehen.

`checkPaths` läuft nach dem Laden und nach jedem Speichern. Unter dem betroffenen
Feld steht dann ein Hinweis — „Verzeichnis existiert nicht", „Datei existiert
nicht", „Pfad ist kein Verzeichnis". Rein informativ, in derselben Form wie die
bestehenden `field-hint`-Zeilen.

## Tests

`tests/pickPath.test.ts` gegen einen eingesetzten Fake: Pfad kommt zurück,
Abbruch ergibt `null`, eine Anfrage mit fremder Adresse ergibt `403`, ohne
injizierte Funktion meldet `GET` `available: false` und `POST` `503`, ein
unbekanntes `kind` ergibt `400`.

`tests/paths.test.ts` gegen echte temporäre Verzeichnisse und Dateien: vorhanden,
fehlend, Datei statt Verzeichnis, Verzeichnis statt Datei, leerer String.

`Settings.test.tsx`: Schaltfläche fehlt, solange die Auswahl nicht verfügbar ist;
ein Klick füllt das Feld; ein Abbruch lässt es unverändert; ein Warnhinweis wird
angezeigt. Die bestehenden Tests laufen weiter, weil `./api` dort ohnehin
gemockt wird und nur um die neuen Funktionen ergänzt werden muss.

Kein Test startet PowerShell. `pickPathWin.ts` ist die Grenze zum Betriebssystem
und wird von Hand geprüft: Verzeichnis wählen, Datei wählen, abbrechen, Dialog
erscheint vor dem Konsolenfenster.
