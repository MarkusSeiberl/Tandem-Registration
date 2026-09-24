# Auto-Update: Handtest-Runbook (Task 12)

Dieser Handtest prüft den einen Schritt, den kein Unit-Test abdeckt: ein
laufendes 114-MB-`tandem.exe`, das sich selbst ersetzt und neu startet — und
danach den Rückroll, wenn das nicht klappt. Er läuft ausschließlich über
`TANDEM_RELEASE_URL` und Temp-Ordner; kein Source-File wird angefasst.

Hintergrund und Details zu jedem der genannten Mechanismen stehen in
`build.md` unter „Selbstupdate“.

## Vorbereitete Ordner (bereits angelegt, nichts davon anfassen)

```
C:\Temp\tandem-updatetest\        installierte 1.1.0 — für den Erfolgslauf (Teil 1)
C:\Temp\tandem-rollbacktest\      installierte 1.1.0 — für den Rollback-Lauf (Teil 2)
C:\Temp\tandem-release\           die "veröffentlichte" 1.1.1 (echt, unverändert)
C:\Temp\tandem-release-broken\    dieselbe 1.1.1, aber tandem.exe auf 1.000.000 Byte abgeschnitten
C:\Temp\tandem-fakeserver\        server.mjs, release.json, release-broken.json
```

**Warum zwei getrennte "installierte" Ordner statt einem:** Nach dem
erfolgreichen Update in Teil 1 steht in `tandem-updatetest` die Version
1.1.1. Das kaputte Release trägt ebenfalls den Tag `v1.1.1` — dieselbe Zahl.
`compareVersions` (`src/server/update/github.ts`) vergleicht nur Zahlen, nicht
Dateiinhalte: „1.1.1“ gegen „1.1.1“ ist nicht neuer, also würde das Update gar
nicht erst angeboten, wenn man den Rollback-Lauf auf dem bereits aktualisierten
Ordner wiederholt. Deshalb bekommt der Rollback-Lauf eine eigene, noch bei
1.1.0 stehende Kopie.

Beide `tandem-*test`-Ordner sind reine Kopien von `dist/tandem.exe` +
`dist/better_sqlite3.node`, gebaut auf 1.1.0 (Commit `825e6f8`). Geht einer
kaputt, genügt ein erneutes Kopieren aus `dist/` (nach `npm run build:all` bei
`package.json`-Version 1.1.0).

## Teil 1: Erfolgreicher Ablauf

### 1. Fake-Server starten

In einem eigenen Terminal-Fenster (bleibt für den ganzen Test offen):

```
cd C:\Temp\tandem-fakeserver
node server.mjs C:\Temp\tandem-release C:\Temp\tandem-fakeserver\release.json
```

Erwartete Ausgabe: `[fake-release] läuft auf http://127.0.0.1:8099 …`. Jede
Anfrage wird geloggt — daran lässt sich später ablesen, ob und wann der
Download tatsächlich stattgefunden hat.

Kurzer Eigen-Check in einem zweiten Fenster (optional, aber beruhigend):

```
curl http://127.0.0.1:8099/latest
```

Antwort sollte mit `"tag_name": "v1.1.1"` beginnen.

### 2. Exe starten, auf den Fake-Server gepointed

In einem dritten Fenster, **cmd.exe** (`set ... &&` gilt nur für den einen
Befehl, ändert also nichts dauerhaft):

```
set TANDEM_RELEASE_URL=http://127.0.0.1:8099/latest
set PORT=8080
C:\Temp\tandem-updatetest\tandem.exe
```

In PowerShell stattdessen:

```
$env:TANDEM_RELEASE_URL = "http://127.0.0.1:8099/latest"
$env:PORT = "8080"
C:\Temp\tandem-updatetest\tandem.exe
```

`PORT=8080` vermeidet, dass Windows Administrator-Rechte für Port 80
verlangt. Der Browser öffnet sich von selbst auf
`http://localhost:8080/manifest`. **Wichtig:** Die Update-Funktionen sind
serverseitig auf Anfragen vom eigenen Rechner beschränkt
(`isLocal`, `src/server/routes/isLocal.ts`) — nur `localhost`/`127.0.0.1`
sieht den Update-Tab und darf ihn benutzen. Über die LAN-IP eines anderen
Geräts bleibt der Tab unsichtbar; das ist Absicht, kein Bug.

### 3. Ablauf beobachten

Rund 5 Sekunden nach dem Start prüft das Programm einmal automatisch (danach
stündlich). Erwartet, in dieser Reihenfolge:

1. **Dialog** „Jetzt aktualisieren?“ (o.ä., siehe `UpdateDialog.tsx`) erscheint
   von selbst. „Jetzt aktualisieren“ klicken.
2. Der Update-Tab in der Sidebar erscheint/aktiviert sich, die Seite zeigt
   einen **Fortschrittsbalken** mit MB-Angabe und Prozent — die 114 MB der
   exe brauchen je nach Leitung/Datenträger einen Moment, sichtbar an
   steigenden Zahlen.
   - Im Fake-Server-Fenster erscheinen `GET /tandem.exe` und danach
     `GET /better_sqlite3.node`.
3. Wenn die Prüfsumme beider Dateien passt, wechselt die Seite auf „Bereit“
   mit dem Knopf „Jetzt installieren und neu starten“. Klicken, den
   Bestätigungsdialog („Das Programm startet dabei neu…“) bestätigen.
4. Die Seite zeigt **„Tandem startet neu…“**.
5. Nach einigen Sekunden **lädt der Tab sich von selbst neu** (die Seite
   pollt im Hintergrund, ob der Server wieder antwortet, und ruft dann
   `location.reload()` selbst auf — kein manuelles F5 nötig) und zeigt wieder
   das Manifest.
6. Update-Tab erneut öffnen: **„Dies ist bereits die aktuellste Version.“**

Falls Windows Defender die frisch geschriebene, unsignierte 114-MB-Datei
scannt, kann Schritt 4 spürbar dauern (bis zu 90 Sekunden, siehe unten) —
das ist normal und kein Hänger.

### 4. Ordnerinhalt danach prüfen

```
dir C:\Temp\tandem-updatetest
```

Muss **genau** enthalten: `tandem.exe`, `better_sqlite3.node`, `config.json`,
`tandem.db` (plus `-wal`/`-shm`, falls die DB gerade offen war/ist).
**Nicht** enthalten sein dürfen: `tandem.old.exe`, `better_sqlite3.old.node`,
`*.new`, `update-failed.json`. Das Vorhandensein eines `.old` oder `.new`
bedeutet, dass der Tausch nicht sauber abgeschlossen hat.

`tandem.exe` sollte jetzt ungefähr die Größe von
`C:\Temp\tandem-release\tandem.exe` haben (114.036.947 Byte).

Teil 1 fertig. Exe-Fenster kann geschlossen bleiben oder laufen — für Teil 2
wird eine andere Kopie verwendet.

## Teil 2: Rollback-Test

### 1. Fake-Server auf das kaputte Release umstellen

Im Fake-Server-Fenster STRG+C, dann neu starten, diesmal mit dem kaputten
Ordner und der kaputten JSON:

```
node server.mjs C:\Temp\tandem-release-broken C:\Temp\tandem-fakeserver\release-broken.json
```

`C:\Temp\tandem-release-broken\tandem.exe` ist eine auf 1.000.000 Byte
abgeschnittene Kopie der echten 1.1.1 — die Prüfsumme in
`release-broken.json` passt exakt zu dieser abgeschnittenen Datei (der
Download besteht also die Verifikation), aber die Datei ist kein lauffähiges
Programm mehr, also scheitert der **Start** der "neuen" Version.

### 2. Exe starten — diesmal die unberührte Rollback-Kopie

```
set TANDEM_RELEASE_URL=http://127.0.0.1:8099/latest
set PORT=8081
C:\Temp\tandem-rollbacktest\tandem.exe
```

(`PORT=8081` statt 8080, damit beide Testläufe notfalls gleichzeitig offen
sein können, ohne sich einen Port zu teilen.)

Dialog akzeptieren, Download abwarten (läuft normal durch, die Prüfsumme der
kaputten Datei stimmt ja), „Jetzt installieren und neu starten“ klicken.

### 3. **Hier unbedingt Geduld haben**

Die Seite zeigt „Tandem startet neu…“ — und bleibt jetzt länger dabei als in
Teil 1. Der Tausch läuft durch, die kaputte exe wird gestartet, aber sie
antwortet nie auf `/api/health`. `installUpdate` (`src/server/update/
install.ts`) wartet darauf **90 Sekunden**, nicht 30, bevor es aufgibt und
zurückrollt — extra lang, weil ein unsigniertes 114-MB-Binary von Windows
Defender erst gescannt werden kann, bevor es überhaupt starten darf; eine
wirklich kaputte Version soll dadurch nicht fälschlich als „vielleicht noch
am Scannen“ durchgehen.

**Der Rollback-Lauf dauert deshalb bis zu anderthalb Minuten, in denen sich
scheinbar nichts tut.** Das Fenster jetzt zuzumachen oder den Prozess zu
killen sähe nach einem Hänger aus, wäre aber genau der falsche Moment — das
ist die geplante Wartezeit, kein Hängenbleiben. Einfach abwarten.

### 4. Was den erfolgreichen Rollback beweist

Nach spätestens ~90 Sekunden:

1. **Der alte Prozess kommt von selbst zurück** — der Tab lädt neu (derselbe
   Poll-Mechanismus wie in Teil 1) und das Manifest ist wieder erreichbar,
   ganz ohne manuellen Eingriff.
2. `dir C:\Temp\tandem-rollbacktest` zeigt wieder ein `tandem.exe` in der
   **ursprünglichen Größe** (114.559.304 Byte, wie beim Start) — nicht die
   1.000.000-Byte-Datei. Kein `.old`, kein `.new` liegt mehr da (`restore()`
   und `cleanupLeftovers` räumen auf).
3. Der Update-Bildschirm zeigt oben in Rot/als Fehlertext genau:

   > Die neue Version ist nicht gestartet. Die vorherige Version wurde
   > wiederhergestellt und läuft weiter.

   Dieser Text kommt aus `update-failed.json`, das `installUpdate` beim
   Fehlschlag schreibt, und wird von `takeFailureMarker` beim Neustart genau
   einmal gelesen und angezeigt (ein zweiter Neustart zeigt ihn nicht mehr).

Wenn alle drei Punkte zutreffen, ist der Rollback bewiesen.

## Aufräumen

1. Beide `tandem.exe`-Prozesse beenden (Fenster schließen oder über den
   Update-/Manifest-Bildschirm „Programm beenden“, oder Task-Manager).
2. Fake-Server mit STRG+C beenden.
3. In jedem Terminal, in dem die Variablen gesetzt wurden, wieder entfernen,
   bevor dort eine andere `tandem.exe` gestartet wird:

   cmd.exe:
   ```
   set TANDEM_RELEASE_URL=
   set PORT=
   ```

   PowerShell:
   ```
   Remove-Item Env:TANDEM_RELEASE_URL
   Remove-Item Env:PORT
   ```

   Eine vergessene `TANDEM_RELEASE_URL` würde die nächste `tandem.exe` in
   diesem Terminal weiter gegen `127.0.0.1:8099` statt gegen GitHub prüfen
   lassen — harmlos, solange der Fake-Server nicht mehr läuft (der Check
   schlägt dann still fehl), aber unnötig verwirrend.
4. Die Ordner unter `C:\Temp\tandem-*` können danach gelöscht werden; nichts
   darin wird von der Anwendung selbst referenziert.
5. `git status --porcelain src/ scripts/` sollte leer sein — der ganze
   Handtest lief über `TANDEM_RELEASE_URL` und Temp-Ordner, keine Quelldatei
   wurde angefasst.
