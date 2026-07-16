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
"build:exe":    "node scripts/check-native-binary.mjs && node scripts/build-exe.mjs && node scripts/copy-native-binary.mjs",
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
  executable, then (3) copies `better_sqlite3.node` into `dist/` beside the
  exe (`copy-native-binary.mjs`) so it can be shipped alongside it.

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

### pkg config (pkg.config.json)

Config lives in `pkg.config.json` (passed explicitly via
`scripts/build-exe.mjs` as `--config pkg.config.json`, which is more
reliable than package.json auto-discovery when pkg is invoked on the
bundled `dist/server.cjs`):

```jsonc
{
  "assets": [
    "web/guest/dist/**/*",     // guest kiosk app, embedded into the exe
    "web/manifest/dist/**/*"   // manifest/staff app, embedded into the exe
  ],
  "outputPath": "dist"
}
```

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
- Tablets on the same Wi-Fi/LAN browse to `http://tandem.local/guest`
  (kiosk / registration form) and the front-desk PC/staff device to
  `http://tandem.local/manifest` (or `manifest` on the host PC itself). If
  mDNS resolution doesn't work on a given tablet, use the PC's static/DHCP
  IP instead, e.g. `http://192.168.1.50/guest`.

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
