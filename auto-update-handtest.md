# Auto-Update: Handtest-Runbook

Dieser Handtest prüft den einen Schritt, den kein Unit-Test abdeckt: ein
laufendes `tandem.exe`, das sich selbst ersetzt und neu startet – und die Wege,
auf denen das schiefgeht. Er läuft über `TANDEM_RELEASE_URL` und einen
Testordner; kein Source-File wird angefasst, nichts wird auf GitHub
veröffentlicht.

Hintergrund und Details zu den Mechanismen stehen in `build.md` unter
„Selbstupdate“.

## Szenarien

| Szenario | Was passiert | Erwartet |
|---|---|---|
| `ok` | Echtes Release, richtige Prüfsummen | Update läuft durch, danach läuft die neue Version |
| `checksum` | Echtes Release, falsche Prüfsumme für `tandem.exe` | Download wird abgelehnt, installierte Version bleibt |
| `broken` | `tandem.exe` auf 1.000.000 Byte abgeschnitten, Prüfsumme passt | Download geht durch, die neue exe startet nicht, Rückroll auf die alte Version |
| `offline` | Release-Adresse, an der niemand antwortet | Prüfung scheitert still, kein Update angeboten |

## 1. Setup bauen

```
npm run update-test:setup
```

Das dauert ein paar Minuten (zwei exe-Builds). Das Skript
(`scripts/update-test/setup.mjs`):

1. baut den aktuellen Code mit einer **um eins niedrigeren Version** (z. B.
   1.4.99) als „installierte“ Version – nur so wird das Release als Update
   angeboten,
2. baut danach mit `npm run build:all` das **Release** in der Version aus
   `package.json` (z. B. 1.5.0). Weil das Release zuletzt gebaut wird, liegt in
   `dist\` danach immer der echte Release-Build,
3. prüft nach jedem Build, dass das Bundle die erwartete Version trägt, und
   bricht sonst ab,
4. legt alles in `C:\Temp\tandem-update-test` ab:

```
C:\Temp\tandem-update-test\
  release\                 das "veröffentlichte" Release
  release-broken\          dasselbe, tandem.exe abgeschnitten
  installed-ok\            je Szenario eine unberührte "alte" Installation
  installed-checksum\
  installed-broken\
  installed-offline\
  start-fake-server.cmd    Fake-GitHub-Server (Port 8099)
  start-ok.cmd             startet installed-ok\tandem.exe auf Port 8091
  start-checksum.cmd       ... Port 8092
  start-broken.cmd         ... Port 8093
  start-offline.cmd        ... Port 8094
```

Jedes Szenario hat seine eigene Installation: Nach einem erfolgreichen Update
läuft dort bereits die neue Version, und dasselbe Release würde nicht noch
einmal angeboten. Für einen neuen Durchgang einfach das Setup neu bauen. Ein
vorhandener Testordner wird dabei gelöscht (nur, wenn er vom Skript stammt).
Läuft noch eine `tandem.exe` daraus, bricht das Skript mit einem Hinweis ab.

Option: `--root <Ordner>` für einen anderen Testordner. Beide Builds laufen
bei jedem Aufruf neu; nichts wird aus einem früheren Lauf übernommen.

## 2. Automatischer Durchlauf (optional, ca. 3 Minuten)

```
npm run update-test:verify
```

Fährt alle vier Szenarien gegen die echten exes über dieselbe API, die der
Update-Bildschirm benutzt, und prüft Version, Phase, Dateigröße und
Aufräumen. Jede exe öffnet dabei kurz ihren Browser-Tab. Am Ende steht z. B.
`19/19 Prüfungen bestanden`. Danach ist das Setup verbraucht: für den
Handtest erst `npm run update-test:setup` erneut ausführen.

## 3. Handtest

### Fake-Server starten

`start-fake-server.cmd` doppelklicken und das Fenster offen lassen. Es zeigt
`[fake-release] läuft auf http://127.0.0.1:8099` und loggt jede Anfrage –
daran sieht man, wann die exe nach Updates fragt und die Dateien lädt.

Die Update-Funktionen sind nur am eigenen Rechner bedienbar (`isLocal`). Den
Manifest-Tab daher immer über `localhost` öffnen, so wie es die exe von selbst
tut.

### Szenario `ok`: erfolgreiches Update

1. `start-ok.cmd` doppelklicken. Der Browser öffnet
   `http://localhost:8091/manifest`.
2. Nach etwa einer Sekunde erscheint der Dialog **Update verfügbar**
   (z. B. 1.4.99 → 1.5.0). Er sagt, dass der Download im Hintergrund läuft und
   erst danach installiert wird. **Herunterladen** klicken.
3. Die Update-Seite öffnet sich: Schritt **1 Herunterladen** ist markiert, der
   Balken zeigt MB und Prozent, danach „Download fertig, wird geprüft…“. Im
   Fake-Server-Fenster: `GET /ok/tandem.exe` und `GET /ok/better_sqlite3.node`.
4. Schritt **2 Installieren**: **Jetzt installieren und neu starten** klicken.
   Der Dialog warnt vor Gästen am Tablet und nennt offene Tandems; „Später“
   hat den Fokus. **Installieren und neu starten** klicken.
5. Schritt **3 Neustart**: „Tandem startet neu… (n s)“ mit Sekundenzähler.
   Die Seite lädt von selbst neu, sobald die neue Version antwortet. (Windows
   Defender kann die frische Datei scannen, dann dauert es länger.)
6. Nach dem Neuladen steht oben **„Tandem wurde auf Version 1.5.0
   aktualisiert.“**, in der Seitenleiste unten „Version 1.5.0“. Die
   Update-Seite sagt „Dies ist bereits die aktuellste Version.“
7. `installed-ok\` enthält danach genau `tandem.exe`, `better_sqlite3.node`,
   `config.json`, `tandem.db` (plus `-wal`/`-shm`). Kein `*.old.*`, kein
   `*.new`, keine `update-failed.json`. Die `.old`-Dateien verschwinden ein
   paar Sekunden nach dem Neustart: Der neue Prozess räumt sie weg, sobald der
   alte beendet ist.

### Szenario `checksum`: Download abgelehnt

1. `start-checksum.cmd`, im Dialog **Herunterladen**.
2. Der Download läuft durch, dann zeigt die Update-Seite: „Der Download hat
   nicht geklappt. Prüfe die Internetverbindung und versuche es erneut.“ und
   darunter **Technische Meldung: Prüfsumme von tandem.exe stimmt nicht. …**
3. Die installierte Version bleibt 1.4.99, `installed-checksum\tandem.exe` ist
   unverändert. **Erneut versuchen** führt erwartungsgemäß zum selben Ergebnis.

### Szenario `broken`: Rückroll nach gescheiterter Installation

1. `start-broken.cmd`, **Herunterladen**. Der Download besteht die Prüfung
   (die Prüfsumme passt zur abgeschnittenen Datei).
2. **Jetzt installieren und neu starten**, im Dialog bestätigen.
3. Windows kann die abgeschnittene exe nicht starten (`spawn EFTYPE`).
   `installUpdate` (`src/server/update/install.ts`) stellt sofort die alte
   Version wieder her und startet sie. Das dauert nur Sekunden; Fenster und
   Prozess in der Zeit nicht beenden.
4. Die Seite lädt neu und öffnet direkt die Update-Seite: **„Version 1.5.0
   ließ sich nicht starten. Tandem wurde neu gestartet und läuft wieder mit
   Version 1.4.99.“**, dazu der Hinweis auf die Tablets und die technische
   Meldung „Unerwarteter Fehler bei der Installation: „Error: spawn EFTYPE“. …“
5. `installed-broken\tandem.exe` hat wieder die ursprüngliche Größe, keine
   `.old`/`.new`-Reste.

Eine exe, die startet, aber nie antwortet, lässt der Server bis zu 90 Sekunden
laufen, bevor er zurückrollt; dann meldet er „Die neue Version ist nicht
gestartet. …“. Diesen Fall stellt das Setup nicht her.

### Szenario `offline`: kein Internet

1. `start-offline.cmd`. Es erscheint **kein** Dialog.
2. Die Update-Seite (Seitenleiste **Update**) sagt, dass die Prüfung nicht
   geklappt hat, und dass das an diesem Standort meist an der fehlenden
   Internetverbindung liegt. Der Rest des Manifests arbeitet normal.

## 4. Aufräumen

1. Alle Test-exes beenden: im Manifest **Programm beenden**, oder im
   Task-Manager „Tandem Registrierung“.
2. Fake-Server-Fenster schließen.
3. `C:\Temp\tandem-update-test` kann gelöscht werden; nichts darin wird von
   der Anwendung selbst referenziert. `dist\` enthält bereits wieder den
   Release-Build.

Die Umgebungsvariablen (`TANDEM_RELEASE_URL`, `PORT`) setzen nur die
`start-*.cmd` für ihr eigenes Fenster. Eine von Hand gestartete
`tandem.exe` fragt wie immer GitHub.

## Erster Lauf (2026-09-24): was schiefging und was behoben ist

1. **Dialog erschien nicht.** Die Seite holte den Status beim Öffnen, bevor die
   Startprüfung lief; der Push danach trägt kein `promptPending`. Jetzt fragt
   der Manifest-Schirm den Status neu ab, sobald ein Release auftaucht
   (`web/manifest/src/App.tsx`), und zeigt den Dialog nur in Phase `available`.
2. **Neue exe startete nicht** (`The "paths[0]" argument must be of type
   string`). pkg schreibt beim `spawn` den eigenen exe-Pfad in `PKG_EXECPATH`;
   die neue exe liegt am selben Pfad und hielt sich deshalb für nacktes
   `node`. `src/server/update/spawn.ts` setzt `PKG_EXECPATH` auf `''`.
   Zusätzlich war die damalige `C:\Temp\tandem-release\tandem.exe` selbst
   defekt (522 KB zu klein, startete auch von Hand nicht); die Release-Ordner
   sind neu gebaut, `release*.json` mit neuen Prüfsummen.
3. **Kein Rückroll, alter Prozess einfach weg.** `waitForHealth` hatte nur
   `unref`-Timer; nach `closeServer` hielt nichts mehr die Event-Loop offen und
   Node beendete sich still. Jetzt `src/server/update/health.ts` ohne `unref`.
4. **Erfolgreiches Update wurde zurückgerollt** (erst nach 2. sichtbar).
   `tandem.old.exe` ist das Image des laufenden alten Prozesses; Windows
   verweigert das Löschen (`EPERM`), das landete im Catch-all. Jetzt toleriert,
   der neue Prozess räumt nach (`cleanupLeftovers`, in `main.ts` wiederholt).
5. **Rückroll-Meldung verschwand** 5 s nach dem Neustart, weil die
   Startprüfung `install-failed` mit `available` überschrieb
   (`src/server/update/state.ts`).

Beide Teile wurden danach automatisiert gegen die echten exes gefahren (Ports
8095/8097, eigener Fake-Server auf 8098) und liefen wie oben beschrieben.
