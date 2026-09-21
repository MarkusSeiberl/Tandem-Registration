# Auto-Update aus GitHub-Releases

## Problem

Ein Update ist heute Handarbeit am Landeplatz-PC: Release-Seite öffnen,
`tandem.exe` und `better_sqlite3.node` herunterladen, das laufende Programm
beenden, beide Dateien im Installationsordner (`%LOCALAPPDATA%`) überschreiben,
neu starten. Wer das nicht macht, merkt nie, dass es eine neue Version gibt —
das Programm hat keinen Kanal, über den eine Version von der nächsten erfährt.
Es kennt nicht einmal seine eigene: nichts im gepackten Exe liest
`package.json`, und `scripts/patch-version-info.mjs` lässt Nodes
Versionsnummern bewusst stehen.

Das Repository ist inzwischen öffentlich, und jedes Release trägt bereits
beide Dateien mit `sha256`-Digest (siehe `gh release view v1.1.0`). Damit ist
alles vorhanden, was ein Selbstupdate braucht.

## Lösung in einem Satz

Der Server fragt bei GitHub nach dem neuesten Release, meldet einen Fund im
Manifest, lädt auf Knopfdruck beide Dateien neben das laufende Exe, prüft ihre
Prüfsummen, tauscht sie per Umbenennen aus, startet sich neu — und nimmt alles
zurück, wenn die neue Version nicht hochkommt.

## Was vorher geprüft wurde

Der ganze Entwurf hängt an einer Windows-Eigenheit, die hier auf Windows 11
nachgemessen wurde, bevor irgendetwas entworfen wurde:

```
RENAME RUNNING EXE: OK
WRITE NEW EXE AT OLD PATH: OK
RENAME LOADED .node: OK
```

Ein laufendes Exe lässt sich umbenennen, an seinen alten Pfad lässt sich sofort
eine neue Datei schreiben, und auch das per `process.dlopen` geladene
`better_sqlite3.node` lässt sich umbenennen. Es braucht also **kein**
Hilfsskript, das nach dem Prozessende aufräumt: der laufende Prozess tauscht
sich selbst aus.

## Beide Dateien, nicht nur das Exe

`better_sqlite3.node` wird von `npm install` für die **Node-Version des
Build-Rechners** gebaut, und `scripts/build-exe.mjs` leitet das pkg-Target aus
genau derselben Node-Version ab. Ein Update, das nur `tandem.exe` ersetzt,
stirbt deshalb beim ersten Start nach einem Node-Major-Wechsel:

```
Error: The module was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires 127.
```

Ein Update tauscht darum immer **beide** Dateien. Ein Release, dem eine der
beiden fehlt, gilt als kein Update.

## Die eigene Version

`scripts/build-server.mjs` löst den esbuild-Aufruf in `package.json` ab und
definiert `__APP_VERSION__` aus `package.json`. Im Dev-Lauf (`tsx`) gibt es das
Define nicht; `src/server/version.ts` fällt dann auf `package.json` aus dem
`cwd` zurück.

Dazu ein Wächter: `build:exe` bricht ab, wenn die Version in `package.json`
nicht dem aktuellen Git-Tag entspricht. Sonst kann `v1.2.0` auf GitHub etwas
anderes bedeuten als die Zahl im Binary, und der Versionsvergleich vergleicht
Lügen.

## Die Abfrage

`GET https://api.github.com/repos/MarkusSeiberl/Tandem-Registration/releases/latest`,
5 s Timeout, kein Retry, ohne Token (60 Anfragen/Stunde pro IP; wir brauchen
24 am Tag). `/latest` blendet Entwürfe und Vorabversionen von sich aus aus.

Aus der Antwort zählt:

- `tag_name` — führendes `v` weg, dann numerischer Vergleich über drei Teile.
  Nur **echt neuer** gilt.
- `body` — die Release-Notes, unverändert übernommen.
- `assets` — es müssen beide Namen exakt vorkommen (`tandem.exe`,
  `better_sqlite3.node`), jeweils mit `browser_download_url`, `size` und einem
  `digest`, der mit `sha256:` beginnt.

Fehlt oder verunglückt etwas davon, ist das Ergebnis „kein Update“ mit einem
Log-Eintrag — nie eine Fehlermeldung auf dem Schirm. Dasselbe gilt für
Netzwerkfehler: ein Landeplatz ohne Internet ist der Normalfall, nicht die
Störung (`build.md`: „lokales Netzwerk, kein Internet nötig“).

Erste Abfrage 5 s nach `listen()`, danach stündlich. Der Timer ist `unref`'t
und hält den Prozess nicht offen.

## Zustand

Ein Objekt im Speicher, die einzige Wahrheit:

```
idle → checking → up-to-date | check-failed | available
available → downloading(%) → verifying → ready | download-failed
ready → installing → (Prozess endet) | install-failed
```

Dazu `disabled`, solange `isPackaged` falsch ist. Ein `npm start`, der
e2e-Lauf und die Unit-Tests aktualisieren sich nie selbst — dieselbe Grenze,
die `notify` und der Beenden-Button schon ziehen.

Jeder Zustandswechsel geht über den vorhandenen `SseHub` als Event `update`
hinaus. Der Fortschritt beim Laden wird auf ein Event pro 500 ms gedrosselt.

## Routen (`src/server/routes/update.ts`)

| Route | Wer | Was |
| --- | --- | --- |
| `GET /api/update/status` | jeder | Zustand, Versionen, Notes, `allowed`, `promptPending`, offene Tandems heute |
| `POST /api/update/check` | localhost | Abfrage jetzt |
| `POST /api/update/download` | localhost | Laden starten, 202 |
| `POST /api/update/install` | localhost | Tauschen und neu starten, 202 |
| `POST /api/update/prompt-seen` | localhost | Dialog wurde gezeigt |

`allowed` ist `isPackaged && isLocal(req.ip)`. `isLocal` ist dieselbe Prüfung,
die `routes/shutdown.ts` schon macht, und aus demselben Grund: das Manifest hat
keine Anmeldung, jedes Gerät im Vereins-WLAN kann es öffnen, und ein Update
beendet den Sprungtag für alle. Die vier `POST`s antworten `403` von außerhalb
und `501` im Dev-Lauf — genau wie `/api/shutdown`.

Die Zahl der offenen Tandems kommt aus
`SELECT COUNT(*) FROM registrations WHERE jump_date = ? AND paid_at IS NULL`
für `today()`. Sie steht im Status, damit die Warnung vor dem Neustart nicht
zwei Endpunkte zusammennähen muss.

## Laden

Beide Dateien wandern nach `installDir` als `tandem.exe.new` und
`better_sqlite3.node.new`. **Nicht** in den Temp-Ordner: das spätere Umbenennen
muss auf demselben Volume stattfinden, sonst ist es ein Kopieren, das
mittendrin scheitern kann.

Der sha256 wird beim Durchlaufen des Streams mitgerechnet und gegen den
`digest` aus dem Release gehalten. Stimmt er nicht, fliegen die Teilstücke weg
und der Zustand wird `download-failed`. Vor dem Start wird geprüft, ob
ungefähr die doppelte Gesamtgröße frei ist.

Kein Resume. Ein abgebrochener Download fängt von vorn an — bei 114 MB
unangenehm, aber ein halb geschriebenes Exe ist schlimmer als eine Wiederholung.

## Tauschen und neu starten

Die Reihenfolge ist das eigentliche Feature:

1. Erst `202` antworten, dann handeln. Der Browser muss gehört haben, dass es
   losgeht, bevor der Server verschwindet (derselbe Griff wie bei
   `/api/shutdown`).
2. Bonjour abmelden, `app.close()`, Datenbank schließen (WAL-Checkpoint).
3. Alte `tandem.old.exe` / `better_sqlite3.old.node` löschen, falls noch da.
4. Beide laufenden Dateien auf `.old` umbenennen.
5. Beide `.new`-Dateien an ihren Platz umbenennen.
6. `tandem.exe` als losgelösten Prozess starten (`detached`, `stdio: 'ignore'`,
   `unref()`).
7. Bis zu 30 s lang `http://127.0.0.1:PORT/api/health` abfragen.
   - Antwortet es: `.old`-Dateien löschen, `process.exit(0)`.
   - Antwortet es nicht: Kind beenden, beide `.old`-Dateien über die neuen
     zurückbenennen, `update-failed.json` neben das Exe schreiben, das
     wiederhergestellte alte Exe starten, beenden.

Der wiederhergestellte Start liest `update-failed.json` einmal, zeigt den Grund
auf dem Update-Schirm und löscht die Datei. Der Operator steht nie vor einer
toten Installation und muss nie selbst etwas umbenennen.

Warum nicht einfach nach einem Fehlschlag weiterlaufen: ein `app.close()` ist
endgültig, eine geschlossene Fastify-Instanz lässt sich nicht erneut
`listen()`. Der Weg über „alte Dateien zurück, alten Prozess neu starten“ ist
der einzige, der den Zustand wirklich wiederherstellt.

Zwei hingenommene Folgen: die neu gestartete Instanz öffnet wie immer ein
frisches Manifest-Tab (`isPackaged`), und die Tablets hängen ihre `EventSource`
von selbst wieder an, sobald der neue Server hört.

## Aufräumen beim Start

`main.ts` prüft vor allem anderen den Installationsordner:

- `tandem.old.exe` / `better_sqlite3.old.node` da → löschen. Dass dieser Prozess
  überhaupt läuft, ist der Beweis, dass die neue Version startet. Fängt auch den
  Fall ab, dass der alte Prozess vor Schritt 7 gestorben ist.
- `*.new` da → löschen, ein abgebrochener Download.
- `update-failed.json` da → in den Zustand laden, Datei löschen.

## Das Manifest

**Sidebar.** Ein neuer Eintrag erscheint nur, wenn ein Update vorliegt **und**
der Client localhost ist. Die Tablets sehen ihn nie — dort ist ohnehin nichts
zu tun, und der Beenden-Button zieht dieselbe Grenze.

**Dialog.** Der Server hält ein Flag „noch nicht gezeigt“. Der erste
Manifest-Aufruf vom Host-PC nach einem Serverstart bekommt das Modal, jeder
weitere Reload nicht — praktisch einmal pro Sprungtag. Ein Fund aus der
stündlichen Abfrage öffnet **nie** ein Modal; er lässt nur den Sidebar-Eintrag
angehen. Ein Modal über einem halb ausgefüllten Manifest um 14 Uhr ist der
schlechteste denkbare Moment.

```
┌ Update verfügbar ──────────────────────────────────┐
│ Version 1.1.0  →  1.2.0                            │
│                                                    │
│ Jetzt herunterladen? Das Programm startet danach   │
│ neu; alle Tablets verlieren kurz die Verbindung.   │
│                                                    │
│ [Jetzt aktualisieren]        [Später]              │
└────────────────────────────────────────────────────┘
```

„Jetzt aktualisieren“ meldet den Dialog als gesehen, startet den Download und
wechselt auf den Update-Schirm. „Später“ meldet ihn nur als gesehen.

**Update-Schirm.** Aktuelle Version, neue Version, Release-Notes und genau eine
zustandsabhängige Aktion: Button „Herunterladen“ / Fortschrittsbalken mit MB
und Prozent / Button „Jetzt installieren und neu starten“ / Fehler mit
Wiederholen. Vor dem Installieren fragt ein `confirm`, das die Zahl der offenen
Tandems von heute nennt und sagt, dass jedes Tablet die Verbindung verliert.
Nach dem `POST` zeigt der Schirm „Tandem startet neu…“, fragt `/api/health` ab,
bis der neue Server antwortet, und lädt die Seite neu.

**SSE.** `useEvents` hört heute nur auf `changed`. Der Update-Zustand bekommt
einen eigenen Hook auf dasselbe `/api/events`, der auf `update` hört — und der
wird nur geöffnet, wenn `allowed` gilt. Tablets bauen dadurch keine zweite
Verbindung auf.

**Release-Notes.** Ein eigener kleiner Renderer für die Teilmenge, die die
Notes tatsächlich benutzen: `##`/`###`, `**fett**`, `` `code` ``, `-`-Listen,
Absätze. Alles andere wird als Text ausgegeben, kein rohes HTML, keine neue
Abhängigkeit. Der Text kommt von GitHub und wird darum wie Fremdtext behandelt.

## Testbarkeit

`github.ts`, `download.ts` und `install.ts` bekommen ihre Außenwelt
hineingereicht — Fetcher, Datei-Operationen, `spawn`, Health-Abfrage. Damit
sind ohne echtes Release prüfbar: der Versionsvergleich, ein Release ohne die
zweite Datei, ein falscher Digest, die Tauschreihenfolge und beide
Rückroll-Zweige gegen einen Temp-Ordner. Die Manifest-Schirme bekommen
vitest-Tests gegen einen gestubbten Status-Endpunkt.

Einmal von Hand vor dem nächsten Release: echtes Exe in einen Temp-Ordner
kopieren, ein Fake-Release von einem lokalen Fastify ausliefern, den echten
Tausch laufen lassen.

## Was dieser Entwurf nicht löst

- **Das Exe ist nicht signiert.** Defender kann ein frisch geschriebenes
  114-MB-Binary erst scannen (langsamer erster Start), SmartScreen kann es
  anmeckern. Eine Code-Signatur ist eine eigene Entscheidung mit eigenen Kosten.
- **Kein Resume.** Ein WLAN-Abbruch bei 90 % kostet den ganzen Download.
- **Die stündliche Abfrage braucht Internet.** Sie ist so gebaut, dass man
  nichts davon merkt, wenn keins da ist.

## Dateien

**Neu:** `src/server/version.ts`,
`src/server/update/{state,github,download,install}.ts`,
`src/server/routes/update.ts`, `scripts/build-server.mjs`,
`scripts/check-version-tag.mjs`,
`web/manifest/src/{Update.tsx,UpdateDialog.tsx,markdown.tsx}` samt Tests.

**Geändert:** `src/server/index.ts`, `src/server/main.ts`,
`web/manifest/src/{App.tsx,api.ts,useEvents.ts,index.css}`, `package.json`,
`build.md`.
