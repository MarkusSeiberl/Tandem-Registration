# Building Tandem as a single Windows .exe

This document describes how "Tandem Registration" is packaged into a single
`tandem.exe` for Windows, what has been verified on this (Linux/WSL) dev
machine, and what still needs a Windows machine to finish/verify.

## Layout being shipped

The web frontends **are embedded inside the exe** (as `pkg` assets). The
only file that must ship *beside* the exe is `better_sqlite3.node` — a
native binary that physically cannot live inside the exe (see "Native
module" below). So the deployment is **exactly 2 files**:

```
C:\Tandem\
├── tandem.exe                  (server + embedded guest & manifest web apps)
├── better_sqlite3.node         (native SQLite binary — MUST sit beside the exe)
├── config.json                 (created on first run / via Settings UI)
└── tandem.db                   (created on first run, WAL mode)
```

(`config.json` and `tandem.db` are created automatically at runtime; you
ship only `tandem.exe` + `better_sqlite3.node`.)

Two things about `pkg`'s virtual `/snapshot` filesystem shape this design:

- **`better-sqlite3` (native `.node`) cannot be embedded** — Windows can
  only `dlopen()` a real file on disk, not one inside the snapshot. So it
  ships as a real file next to the exe, and `main.ts` points better-sqlite3
  at it via its `nativeBinding` option (bypassing the `bindings` filesystem
  search that fails inside a packaged exe). `build:exe` copies it into
  `dist/` automatically.
- **The web assets *are* embedded**, but `@fastify/static` can't reliably
  read them straight out of the snapshot. So at startup `main.ts` extracts
  the embedded `web/` tree to a temp folder (`os.tmpdir()/tandem-web`) using
  `fs` and serves from there. No `web/` folder needs to ship.

## Packaged-mode detection (bugfix)

`src/server/main.ts` used to detect "am I running packaged?" via:

```ts
const isPackaged = !path.dirname(process.execPath).includes('node_modules')
```

This is wrong: a dev run via `nvm`/system Node also has `process.execPath`
outside any `node_modules` folder, so dev was frequently misdetected as
"packaged", which made the server look for `web/` next to the Node binary
instead of the project directory.

Fixed to use the marker `@yao-pkg/pkg` (and the original `vercel/pkg`)
injects into the packaged process at runtime:

```ts
const isPackaged = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined'
```

- In dev (`tsx`/plain `node`): `process.pkg` is `undefined` → `isPackaged`
  is `false` → `installDir = process.cwd()`.
- Packaged by `pkg`: `process.pkg` exists → `isPackaged` is `true` →
  `installDir = path.dirname(process.execPath)` (the folder containing
  `tandem.exe`).

Verified on Linux (dev mode only — see "What's verified" below): booting
with `tsx src/server/main.ts` from the project root resolves `installDir`
to the project root, and `/guest` and `/manifest` are served correctly from
`web/guest/dist` and `web/manifest/dist`.

## Build pipeline

Three npm scripts, chained by `build:all`:

```jsonc
"build:web":    "npm --prefix web/guest run build && npm --prefix web/manifest run build",
"build:server": "esbuild src/server/main.ts --bundle --platform=node --format=cjs --target=node22 --external:better-sqlite3 --outfile=dist/server.cjs",
"build:exe":    "node scripts/check-native-binary.mjs && node scripts/build-exe.mjs && node scripts/patch-subsystem.mjs && node scripts/patch-version-info.mjs && node scripts/copy-native-binary.mjs",
"build:all":    "npm run build:web && npm run build:server && npm run build:exe"
```

- `build:web` — builds both Vite frontends (`tsc -b && vite build` in each
  of `web/guest` and `web/manifest`), producing `web/guest/dist` and
  `web/manifest/dist`.
- `build:server` — bundles `src/server/main.ts` and everything it imports
  (fastify, exceljs, bonjour-service, our own route/db/config code) into a
  single CommonJS file `dist/server.cjs`. `better-sqlite3` is kept
  `--external` because it's a native addon — esbuild can't (and shouldn't)
  inline a native `.node` binary into a JS bundle.
- `build:exe` — (1) guards that the native binary is a Windows PE
  (`check-native-binary.mjs`), (2) runs `@yao-pkg/pkg` (the maintained fork
  of `vercel/pkg`; original `pkg` is unmaintained and doesn't support current
  Node) against `dist/server.cjs` to produce the single-file Windows
  executable, (3) flips the exe's PE subsystem to GUI so it starts without a
  terminal window (`patch-subsystem.mjs`, see below), (4) rewrites the exe's
  Windows version strings so the process is called "Tandem Registrierung"
  instead of "Node.js JavaScript Runtime" (`patch-version-info.mjs`, see
  below), then (5) copies `better_sqlite3.node` into `dist/` beside the exe
  (`copy-native-binary.mjs`) so it can be shipped alongside it.

### No console window (GUI subsystem)

`pkg` always emits a PE with subsystem `WINDOWS_CUI` (3, "console"), so
double-clicking the exe popped a black terminal with a taskbar button — one the
operator must not close, since closing it kills the server mid-registration.
`scripts/patch-subsystem.mjs` rewrites that field to `WINDOWS_GUI` (2) after
packaging. The byte sits at `e_lfanew + 92` (`e_lfanew` is the 4-byte LE offset
at 0x3C; then 4 bytes of `PE\0\0` signature, the 20-byte COFF header, and the
optional header's Subsystem field at offset 68 — same in PE32 and PE32+). The
script refuses anything that isn't a PE or whose subsystem is neither 2 nor 3,
and is idempotent, so re-running it on an already-patched exe is a no-op.
Covered by `tests/patchSubsystem.test.ts` against synthetic PE headers.

Three consequences, all handled in `src/server/main.ts`:

- **No console to print to.** `console.log`/`console.error` go nowhere in the
  packaged exe, so the startup banner is invisible there (it still prints in
  dev). Fatal startup problems — missing `better_sqlite3.node`, missing fonts,
  an occupied port — go through `fatal()`, which additionally shows the message
  in a Windows message box (PowerShell + `System.Windows.Forms.MessageBox`,
  command passed as `-EncodedCommand` and the text as base64 so quotes,
  umlauts and newlines can't break the quoting). Without it the exe would die
  completely silently.
- **Starting the exe again reopens the manifest.** With no console and no
  taskbar window, an operator who closes the browser tab has nothing left to
  click. So a second start — which fails with `EADDRINUSE` because the first
  instance owns the port — probes `http://127.0.0.1:PORT/api/health`; if a
  Tandem answers, it just opens the manifest in the browser and exits 0,
  leaving the running instance untouched. `EADDRINUSE` from something that is
  *not* Tandem (IIS, Skype) still reports a real error in the message box.
- **The web assets are extracted only after `listen` succeeds.** The temp dir
  (`os.tmpdir()/tandem-web`) is created empty before `@fastify/static` is
  registered (it needs an existing root) and filled in the `listen().then()`.
  Otherwise the second start above would rewrite the very files the running
  instance is serving to the tablets.

Also: `openBrowser` passes `windowsHide: true` — the `cmd.exe` behind
`start "" <url>` would otherwise flash a window now that the exe has no console
of its own.

### Process name in the Task Manager (version resource)

`pkg` builds the exe on top of a stock `node.exe` and inherits its Windows
version resource, and Windows names a running process after that resource's
`FileDescription`. So the Task Manager listed `tandem.exe` as **"Node.js
JavaScript Runtime"** — with no console window and no taskbar button (see
above), the operator had no way to recognise the registration server among the
processes. `scripts/patch-version-info.mjs` rewrites four strings after
packaging:

| Field | before | after |
| --- | --- | --- |
| `FileDescription` | Node.js JavaScript Runtime | Tandem Registrierung |
| `ProductName` | Node.js | Tandem |
| `InternalName` | node | tandem |
| `OriginalFilename` | node.exe | tandem.exe |

`CompanyName`, `LegalCopyright` and the version numbers stay as Node shipped
them — the embedded runtime really is Node, and the copyright is its own.

**The resource is edited byte-for-byte in place, never rebuilt.** `pkg` appends
its payload (bundled sources and assets, ~22 MB) *after* the last PE section
and addresses it by absolute file offset, so any tool that regenerates the PE
(`rcedit`, `resedit`, …) drops or displaces the payload and leaves an exe that
no longer starts. The script therefore keeps the file size and every existing
offset intact: it only rewrites bytes inside the `StringTable` of
`VS_VERSION_INFO`, keeping that table's declared length constant. Leftover
space is absorbed by the last entry, whose declared length is inflated to cover
it — a `String` struct may be longer than its content, readers take the value
via `wValueLength`.

That fixed length is the one constraint: the new strings must fit into the
space the Node ones occupied (each struct 4-byte aligned). They do, with a few
bytes to spare — shrinking `FileDescription` from 26 to 20 characters pays for
the longer `OriginalFilename` and `InternalName`. If a future rename doesn't
fit, the script aborts with the byte counts instead of shifting anything.
It is idempotent (a second run reports "nothing to patch"), and refuses a file
that is not a PE, has no `.rsrc` section, or carries no version block. Covered
by `tests/patchVersionInfo.test.ts` against a synthetically built version
resource.

Two things the rename does *not* change: the taskbar/window title (there is no
window) and the exe's icon (still Node's — an icon is a separate resource that
cannot be swapped without rebuilding `.rsrc`).

### Node version / ABI matching (do NOT hardcode the target)

`better-sqlite3` is loaded at runtime as an external native binary
(`better_sqlite3.node`) that `npm install` built for **the build machine's
Node version**. A native addon only loads into a Node runtime with the
**same ABI** (`NODE_MODULE_VERSION`): Node 22 = ABI 127, Node 24 = ABI 137.
If the exe embeds a different Node runtime than the one the `.node` was built
for, it fails at startup with:

```
Error: The module was compiled against a different Node.js version using
NODE_MODULE_VERSION 137. This version of Node.js requires 127.
```

To make this impossible to get wrong, `scripts/build-exe.mjs` derives the
`pkg` target from the build machine's own Node version at build time
(`node${major}-win-x64`) instead of hardcoding it. So the embedded runtime
and the shipped `better_sqlite3.node` always share an ABI, whatever Node the
person building it happens to have (as long as `@yao-pkg/pkg` publishes a
base binary for that major — it does for Node 18/20/22/24).

Caveat: build with a Node version that has a matching `better-sqlite3`
prebuild. `better-sqlite3@12.11.1` ships Windows prebuilds for ABI 127+
(Node 22, 24), so build on **Node 22 or Node 24**. (Node 20 / ABI 115 has no
upstream Windows prebuild for this version, so don't build the release on
Node 20.) esbuild's `--target=node22` only controls JS syntax downleveling
and is a safe floor — it runs fine on the Node 22/24 runtime `pkg` embeds.

## Selbstupdate

`tandem.exe` fragt 5 s nach dem Start und danach stündlich bei
`api.github.com/repos/MarkusSeiberl/Tandem-Registration/releases/latest` nach
einer neueren Version und bietet sie im Manifest an. Der Tausch läuft im
laufenden Prozess ab — auf Windows darf ein laufendes Exe umbenannt und an
seinen alten Pfad sofort neu geschrieben werden, und für das geladene
`better_sqlite3.node` gilt dasselbe (siehe `installUpdate` in
`src/server/update/install.ts`). Deshalb gibt es kein Hilfsskript: Der Prozess
schließt Bonjour/Fastify/DB, benennt beide laufenden Dateien nach
`tandem.old.exe`/`better_sqlite3.old.node` um, schreibt die heruntergeladenen
`.new`-Dateien an ihren alten Platz und startet die neue Version als
eigenständigen Kindprozess über `spawnDetached`. Dieser Kindprozess bekommt
`TANDEM_RESTART=1` gesetzt: Der Port ist im Moment des Starts oft noch von der
alten Instanz belegt (sie beendet sich gerade erst), und `TANDEM_RESTART`
sagt dem Kind, dass es sich um einen Ersatz und keine zweite Instanz handelt —
es muss den Port bis zu 60 s lang erneut zu binden versuchen, statt (wie beim
normalen Doppelklick) höflich aufzugeben und sich auf die bereits laufende
Instanz zu verlassen.

**Der 90-Sekunden-Gesundheitscheck.** Nach dem Start der neuen Version wartet
`installUpdate` bis zu **90 s** (nicht 30) auf `waitForHealth`, bevor es die
alten Dateien endgültig löscht. 90 s statt 30, weil das Exe unsigniert ist:
Windows Defender kann ein frisch geschriebenes, 114 MB großes Binary erst
scannen, bevor es überhaupt starten darf, und dieser Scan kann auf einem
langsamen Rechner mehrere zehn Sekunden dauern. Eine wirklich kaputte neue
Version scheitert ohnehin in Sekunden — die lange Wartezeit kostet also nur im
seltenen echten Fehlerfall Zeit, nie im Erfolgsfall.

**Aufräumen beim Start.** Zwei Funktionen in `install.ts` laufen bei jedem
Programmstart, bevor der Server lauscht, und sind beide bewusst tolerant
gegenüber Dateien, die ein Virenscanner, ein Backup-Tool oder der Windows-
Indexer gerade gesperrt hält (`EBUSY`/`EPERM`/`EACCES`): ein Wurf hier hieße,
das Programm startet gar nicht erst.
- `cleanupLeftovers` löscht `tandem.old.exe`, `better_sqlite3.old.node`
  (Rückroll-Kopien eines geglückten Updates) und liegen gebliebene
  `*.new`-Dateien (abgebrochene Downloads). Jede Datei wird einzeln versucht,
  damit eine gesperrte Datei nicht auch das Löschen der anderen verhindert —
  ein Fehler landet nur als Warnung im Log.
- `takeFailureMarker` liest `update-failed.json` (der Grund eines
  gescheiterten Versuchs) genau einmal aus und löscht die Datei danach; lässt
  sich die Datei nicht löschen, bleibt sie liegen und der Grund erscheint beim
  nächsten Start erneut — unschön, aber kein Startabbruch.

**Ein Release muss beide Dateien tragen.** `better_sqlite3.node` ist gegen die
Node-ABI des Build-Rechners gebaut, und `build-exe.mjs` leitet das pkg-Target
aus derselben Node-Version ab; ein Update, das nur das Exe tauscht, stirbt nach
einem Node-Major-Wechsel beim Start. `parseRelease`
(`src/server/update/github.ts`) ignoriert ein Release, dem eine der beiden Dateien fehlt,
vollständig — es erscheint dem Programm gegenüber, als gäbe es keine neuere
Version.

**Die Version muss zum Tag passen.** `build:exe` ruft als **allerersten**
Schritt `scripts/check-version-tag.mjs` auf und bricht ab, wenn `package.json`
etwas anderes sagt als der Git-Tag auf HEAD (kein Tag auf HEAD = gewöhnlicher
Entwicklungsbuild, keine Prüfung). Erst danach folgen
`check-native-binary.mjs`, `build-exe.mjs`, `patch-subsystem.mjs`,
`patch-version-info.mjs` und `copy-native-binary.mjs`.
`scripts/build-server.mjs` stempelt die Version aus `package.json` als
`__APP_VERSION__` in das Bundle — das ist die Zahl, gegen die der Updater die
Release-Version vergleicht.

**Checkliste für ein Release**

1. Version in `package.json` anheben.
2. Commit, dann `git tag vX.Y.Z`.
3. `npm run build:all`.
4. `gh release create vX.Y.Z dist/tandem.exe dist/better_sqlite3.node --notes-file …`

Die Release-Notes werden im Manifest angezeigt. Unterstützt sind `##`/`###`,
`**fett**`, `` `code` `` und `-`-Listen — alles andere erscheint als Text.

**Gegen ein echtes Release testen, ohne eines zu veröffentlichen:**
`TANDEM_RELEASE_URL` auf eine lokal ausgelieferte Kopie der GitHub-Antwort
setzen — überschreibt für genau diesen Prozess, wohin `fetchLatestRelease`
fragt. Ohne die Variable fragt das Programm immer GitHub. `asAsset`
(`github.ts`) lässt für `browser_download_url` neben `https:` ausdrücklich
auch reines `http://` auf `localhost`/`127.0.0.1`/`::1` zu — genau diese
Ausnahme macht den lokalen Testaufbau ohne selbstsigniertes Zertifikat
möglich; siehe `docs/superpowers/plans/2026-09-21-auto-update-handtest.md`
für den vollständigen Handtest-Ablauf.

### pkg config (pkg.config.json)

Config lives in `pkg.config.json` (passed explicitly via
`scripts/build-exe.mjs` as `--config pkg.config.json`, which is more
reliable than package.json auto-discovery when pkg is invoked on the
bundled `dist/server.cjs`):

```jsonc
{
  "assets": [
    "web/guest/dist/**/*",     // guest kiosk app, embedded into the exe
    "web/manifest/dist/**/*",  // manifest/staff app, embedded into the exe
    "assets/**/*"              // contract template + the fonts it is drawn with
  ],
  "outputPath": "dist"
}
```

`assets/` holds the `Befoerderungsvertrag.pdf` template and the two DejaVu Sans
Condensed faces the contract's text is drawn with (licence beside them). The
fonts are not a nicety: the PDF standard fonts can only encode WinAnsi, and a
guest from across the Czech border 30 km away could not register at all while
the contract was drawn with one (see `src/server/contractPdf.ts`). Both are
embedded subset, so a contract grows by a few kB rather than by the 660 kB of
the file. `src/server/main.ts` refuses to start if either is missing, so the
failure shows up on the operator's console instead of at the tablet.

Unlike the web frontends, the contract template is read with a single `fs.readFileSync` in `main.ts` (see `contractPdf.ts` usage there), so it does not need the extraction-to-tempdir step `@fastify/static` requires.

No `targets` here — `scripts/build-exe.mjs` passes `--targets
node${major}-win-x64` computed from the build machine's Node version (see
"Node version / ABI matching" above), so hardcoding it would just risk
drifting out of sync with the native binary's ABI.

**Do NOT add `better_sqlite3.node` to `assets`.** An earlier
version of this build tried to embed the `.node` as a `pkg` asset. That
does not work: the native addon ended up (or was expected) inside `pkg`'s
virtual `/snapshot` filesystem, and at runtime `better-sqlite3` →
`bindings` tries to `stat`/`require` that snapshot path and Windows cannot
`dlopen()` a DLL out of the virtual FS. The exe crashed with:

```
Error: File ... 'better_sqlite3.node' was not included into executable at
compilation stage. Please recompile adding it as asset or script.
  at bindings (C:\snapshot\...\node_modules\bindings\bindings.js)
```

The fix (see "Layout being shipped") is to keep the `.node` as an external
real file beside the exe and load it via better-sqlite3's `nativeBinding`
option, so `bindings` is never invoked in the packaged build.

Note: the pkg config intentionally omits a `bin` field. `bin` is only
needed when pkg has to *discover* the entry point from `package.json`
(e.g. `pkg .`); here `build:exe` passes `dist/server.cjs` directly on the
CLI, so pkg already knows the entry file and `bin` would be redundant.

### Preflight guard against shipping the wrong-platform binary

`build:exe` first runs `node scripts/check-native-binary.mjs`. It checks
the first two bytes of `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
for the `MZ` PE magic number and fails the build loudly if it isn't a
Windows PE binary — because that is the exact file `copy-native-binary.mjs`
will place beside the exe. This prevents shipping a Linux/macOS `.node` that
would fail to `dlopen()` on Windows. See "Native module: how the Windows
`better_sqlite3.node` is obtained" below for how to fetch the correct prebuild.

## Native module: how the Windows `better_sqlite3.node` is obtained

This is the one step that **cannot be fully validated on Linux** — it
needs the *contents* of the `.node` file to be Windows-x64 code, but it can
be *obtained* on Linux without a Windows machine, because `better-sqlite3`
ships prebuilt binaries per-platform on GitHub Releases and
`prebuild-install` just downloads the matching release asset (no local
compilation happens):

```bash
cd node_modules/better-sqlite3
# Use THIS machine's Node version so the ABI matches the exe target that
# scripts/build-exe.mjs will pick (node${major}-win-x64):
../.bin/prebuild-install --platform=win32 --arch=x64 --target="$(node -p process.versions.node)"
```

This downloads the matching
`better-sqlite3-v12.11.1-node-v<ABI>-win32-x64.tar.gz` from
`https://github.com/WiseLibs/better-sqlite3/releases/` and unpacks it over
`node_modules/better-sqlite3/build/Release/better_sqlite3.node`. **This
overwrites your local dev binary** — after running `build:exe` you must
restore the native build for your own OS before running tests/dev again:

```bash
rm -rf node_modules/better-sqlite3/build
npm rebuild better-sqlite3
```

Full sequence for a from-scratch build on any machine with npm + internet
access (Linux, macOS, or Windows all work for *this* step — it's just a
download):

```bash
npm run build:web
npm run build:server

# swap in the Windows-x64 native binary (for THIS machine's Node ABI) before packaging:
cd node_modules/better-sqlite3
../.bin/prebuild-install --platform=win32 --arch=x64 --target="$(node -p process.versions.node)"
cd ../..

npm run build:exe        # builds dist/tandem.exe AND copies the (now win32-x64) better_sqlite3.node into dist/ beside it

# restore your own platform's binary so local dev/tests keep working:
rm -rf node_modules/better-sqlite3/build
npm rebuild better-sqlite3
```

An equally valid (arguably simpler for a Windows-based release process)
alternative is to just run `npm run build:all` **on a Windows machine**
with the matching Node version installed — `npm install` there will pull
the correct win32-x64 prebuild automatically, and no binary-swap dance is
needed.

### How the native module is loaded at runtime

`pkg` cannot `dlopen()` a native addon out of its virtual filesystem, so we
do not rely on that. Instead:

- `dist/better_sqlite3.node` is a real file shipped **beside** `tandem.exe`.
- When packaged (`process.pkg` defined), `main.ts` sets
  `installDir = dirname(process.execPath)` and calls
  `openDb(dbPath, path.join(installDir, 'better_sqlite3.node'))`.
- `openDb` passes that path to `new Database(dbPath, { nativeBinding })`,
  which `require()`s the `.node` from that real on-disk path directly —
  `bindings` is never called, so there is no snapshot-path lookup to fail.

Requirement: **`better_sqlite3.node` must sit in the same folder as
`tandem.exe`.** If it's missing or in the wrong folder, the server exits at
startup while opening the database. (In dev, `nativeBinding` is left
undefined and better-sqlite3 resolves normally from `node_modules`.)

## Runtime notes

- Default port is `80` (see `src/server/main.ts`) so tablets can reach
  `http://tandem.local/guest` or `http://tandem.local/manifest` without a
  port in the URL, and mDNS (`bonjour-service`) advertises `tandem.local`
  on the local network. Binding port 80 on Windows requires running
  `tandem.exe` as Administrator (or use a reserved-port ACL). For a
  non-privileged run, set `PORT` (e.g. `set PORT=8080 && tandem.exe`) and
  browse to `http://tandem.local:8080/guest`.
- Allow the app through Windows Firewall (Private network) on first run —
  Windows will prompt; accept it, or add a rule for `tandem.exe` manually if
  the prompt is suppressed.
- `DIR` env var overrides where `tandem.db` and `config.json` are read from
  and written to; defaults to the exe's own folder.
- **Reaching the server / why `tandem.local` is unreliable.** On startup the
  URLs that actually work are logged: `http://localhost:PORT/...` on the host
  itself, and `http://<LAN-IP>:PORT/...` for other devices (the app lists every
  non-internal IPv4 it finds — pick the one on the same Wi-Fi as the tablets).
  Note the packaged exe has no console (see "No console window" above), so
  there the banner is invisible; on the host itself the browser opens by
  itself at startup and again on every further double-click of the exe. The
  LAN IPs for the tablets currently have no such fallback — they are visible
  only in a dev run. **Prefer the LAN IP** — it is the only method that works
  on every device. `tandem.local` (mDNS) is offered as a "if supported" extra
  and frequently does NOT resolve because:
  - **Android** does not resolve typed `.local` mDNS hostnames in the browser
    at all. iOS/iPadOS, macOS and modern Windows do.
  - **Virtual adapters** (Hyper-V, WSL, VirtualBox/VMware, VPNs) make the host
    multi-homed; the mDNS multicast may leave via a virtual interface instead
    of the real LAN (you'll see `192.168.x.1`-style addresses in the startup
    list next to the real one).
  - **Windows Firewall** must allow inbound **UDP 5353** (mDNS), not just the
    HTTP port, for other devices to receive the advertisement.
  - A leftover advertisement from a previous run can trigger `Service name is
    already in use on the network` from `bonjour-service`; the HTTP server
    still runs fine, but name resolution gets flaky. `localhost` / the LAN IP
    are unaffected.

  The server does advertise an A record for `tandem.local` itself (via the
  `host: 'tandem.local'` option on `bonjour.publish`), so it can work on a
  clean single-NIC network with iOS/macOS/Windows clients — but do not rely on
  it for a mixed tablet fleet; use the printed LAN IP.

## What's verified on Linux vs. what needs Windows

Verified on this Linux/WSL dev machine:
- `npm run build:web` — both `web/guest/dist` and `web/manifest/dist` built successfully.
- `npm run build:server` — produced `dist/server.cjs` (~3.9 MB bundle).
- **The bundle actually runs**: `PORT=8125 DIR=/tmp/tandem-pkg node dist/server.cjs`
  → `curl /api/health` → `{"ok":true}`, `/guest/` → 200, `/manifest/` → 200.
  (better-sqlite3 resolved fine from `node_modules` since it stayed external
  to the esbuild bundle.)
- `npm run build:exe` — runs to completion and produces a genuine
  `dist/tandem.exe` (`PE32+ executable (console) x86-64, for MS Windows`,
  ~74 MB). Confirmed the source `.node` file's format (`file(1)`: `ELF` vs.
  `PE32+ DLL`) immediately before each `pkg` invocation, to prove *which*
  native binary was embedded.
- The dev-mode detection fix: booting via `tsx src/server/main.ts` (no
  `process.pkg`) resolves `installDir` to the project directory and serves
  `/guest` and `/manifest` correctly.
- The `nativeBinding` load path: `openDb(':memory:', <path>)` loads the real
  `better_sqlite3.node` and runs queries; a bogus binding path throws
  (proving the option is actually used, not ignored). See `tests/db.test.ts`.
- Root vitest suite: 47/47 tests pass. `tsc --noEmit`: clean.

### Runtime bug found on Windows and fixed (2026-07)

The first Windows run of `tandem.exe` crashed at startup:

```
Error: File ... 'better_sqlite3.node' was not included into executable at
compilation stage.  at bindings (C:\snapshot\...\bindings\bindings.js)
```

Root cause: we were relying on `pkg` to embed/serve the native addon, but a
packaged exe cannot `dlopen()` a `.node` from its virtual `/snapshot` FS, and
`better-sqlite3`'s `bindings`-based search resolves to exactly such a
snapshot path. Fix: ship `better_sqlite3.node` beside the exe and load it via
better-sqlite3's `nativeBinding` option (`db.ts` / `main.ts`), removing the
`pkg` `assets` embed entirely. To rebuild after this fix, re-run the "Full
sequence" above (or `npm run build:all` on Windows) and deploy the resulting
`dist/tandem.exe` **and** `dist/better_sqlite3.node` together.

Two follow-on issues surfaced on subsequent Windows runs and were also fixed:

1. **`MODULE_NOT_FOUND` for the `.node`** — the file must be named exactly
   `better_sqlite3.node` and sit beside the exe. `main.ts` now checks for it
   at startup and, if missing, prints the exact expected path plus a listing
   of the folder's actual contents, instead of a cryptic loader error.
2. **`NODE_MODULE_VERSION` mismatch** (e.g. "compiled against 137, requires
   127") — the exe embedded a Node 22 runtime while the shipped `.node` was
   built for Node 24. Fixed by deriving the `pkg` target from the build
   machine's Node version (`scripts/build-exe.mjs`) so the runtime and the
   native binary always share an ABI. See "Node version / ABI matching".
3. **Web app "not built yet" / 404** — the frontends were expected in a
   `web/` folder beside the exe that the build never assembled there. Fixed
   by embedding `web/*/dist` into the exe (`pkg.config.json` assets) and
   extracting them to a temp dir at startup, so deployment is just the exe +
   `better_sqlite3.node`.

### Verified on Windows (2026-09)

Built with `npm run build:all` on Windows 11 / Node 24.18.0 and smoke-tested
against the real `dist/tandem.exe` (`PORT=8123`, `DIR` pointing at a scratch
folder):

- The patched exe's PE subsystem reads back as `2` (GUI).
- Started by double-click equivalent (`Start-Process`): no console window and
  no taskbar button (`MainWindowHandle` is 0), `GET /api/health` →
  `{"ok":true}`.
- Starting the exe a second time exits with code 0, reopens the manifest in the
  browser, and leaves the first instance serving (`/api/health` still ok).
- With `better_sqlite3.node` deliberately absent, the exe blocks on a message
  box titled "Tandem" (child `powershell.exe`) instead of dying silently.
- `POST /api/shutdown` (the manifest's "Programm beenden" button) ends the
  packaged GUI-subsystem process cleanly.

Cannot be verified on Linux/WSL (no Windows, no way to execute a `.exe`,
no `wine` installed in this environment):
- That `dist/tandem.exe` (post-fix) actually **launches and runs correctly
  on Windows** — i.e. that `process.pkg` detection flips `isPackaged` to
  `true`, that better-sqlite3 loads `better_sqlite3.node` from beside the exe
  via `nativeBinding` and `dlopen()`s successfully on Windows, that Fastify
  binds port 80/8080 on Windows, and that mDNS advertisement
  (`bonjour-service`) works on a Windows network stack. (The pre-fix embed
  approach was confirmed BROKEN on Windows — see the "Runtime bug" note
  above; the fix is verified only structurally on Linux.)
- That the win32-x64 `better-sqlite3` prebuild swapped in before packaging
  is actually loadable at runtime. We only verified it's a well-formed PE
  DLL by file type (`file(1)`) and that its byte size differs from the
  Linux `.node` — we could not `require()` it on this machine to confirm it
  actually `dlopen()`s and matches the exe's Node ABI on Windows.
- Tablet-facing acceptance: reaching `http://tandem.local/guest` and
  `http://tandem.local/manifest` from a real tablet on the venue's Wi-Fi,
  Windows Firewall prompt behavior, and running as a non-admin user on
  port 8080.

**Recommendation**: before relying on this in production, do one full
`npm run build:all` + smoke test directly on a Windows machine (or a
Windows CI runner) with the target Node version installed, confirm
`tandem.exe` starts, `GET /api/health` returns `{"ok":true}`, and a
registration can be created end-to-end through `/guest` and reviewed
through `/manifest`.
