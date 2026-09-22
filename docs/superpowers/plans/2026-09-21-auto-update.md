# Umsetzungsplan: Auto-Update aus GitHub-Releases

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Design: `docs/superpowers/specs/2026-09-21-auto-update-design.md`

**Goal:** Das gepackte `tandem.exe` erkennt ein neues GitHub-Release, lädt
`tandem.exe` und `better_sqlite3.node`, tauscht beide aus, startet sich neu und
rollt zurück, wenn die neue Version nicht hochkommt.

**Architecture:** Der Server besitzt den ganzen Vorgang — er darf in
`installDir` schreiben und er ist der Prozess, der sterben muss. Vier kleine
Module unter `src/server/update/` (Abfrage, Zustand, Laden, Tauschen) bekommen
ihre Außenwelt hineingereicht und sind dadurch ohne echtes Release prüfbar.
`src/server/routes/update.ts` legt sie vor das Manifest, das nur zeichnet, was
der Zustand sagt, und Fortschritt über den vorhandenen `SseHub` hört.

**Tech Stack:** TypeScript, Fastify 5, better-sqlite3, vitest (Server:
`environment: 'node'`), React 19 + @testing-library (Manifest, eigene
vitest-Konfiguration unter `web/manifest/`), esbuild + `@yao-pkg/pkg` für den
Build. Keine neuen Laufzeit-Abhängigkeiten — `fetch`, `crypto`, `fs.statfsSync`
und `child_process.spawn` sind alle in Node 22 vorhanden.

## Global Constraints

Diese gelten für jeden Task und sind verbindlich:

1. **Sprache.** Sichtbarer Text ist Deutsch, mit typografischen
   Anführungszeichen („…“) wie im übrigen Manifest. Code-Kommentare sind
   Englisch und erklären *warum*, nicht *was* — der Ton von `main.ts` und
   `List.tsx`.
2. **Keine neuen Abhängigkeiten.** Weder im Server noch in `web/manifest`.
   Kein Markdown-Paket, kein Semver-Paket, kein HTTP-Client.
3. **Der Dev-Lauf aktualisiert sich nie selbst.** Alles hinter `isPackaged`.
   `npm start`, der Playwright-Lauf und jeder Unit-Test sehen `phase:
   'disabled'`; die vier `POST`-Routen antworten dort `501`, genau wie
   `/api/shutdown` es schon tut.
4. **Nur localhost darf handeln.** Die vier `POST`-Routen benutzen dieselbe
   `isLocal(req.ip)`-Prüfung wie `src/server/routes/shutdown.ts`. Von außen:
   `403`.
5. **Beide Dateien.** Jeder Pfad, der eine Datei anfasst, fasst beide an:
   `tandem.exe` **und** `better_sqlite3.node`. Ein Release mit nur einer der
   beiden gilt als kein Update.
6. **Netzwerkfehler sind still.** Eine gescheiterte Abfrage loggt und setzt
   `check-failed`; sie wirft nie, blockiert nie `listen()` und erscheint nie
   als Fehlermeldung auf einem Tablet.
7. **Kein rohes HTML.** Der Release-Text kommt von GitHub und wird
   ausschließlich als React-Elemente gerendert. Nie `dangerouslySetInnerHTML`.
8. **TDD.** Test zuerst, rot sehen, dann implementieren. Jeder Task endet mit
   grünem `npm test` (Wurzel) bzw. `npm --prefix web/manifest test` und
   sauberem `npx tsc -b`.
9. **Sauberer Baum.** Jeder Task committet genau die unter **Files**
   genannten Dateien, mit einer Commit-Zeile im Stil des Repos
   (`feat(update): …`, `fix(update): …`, `docs(update): …`).

**Prüfbefehle**

| Was | Befehl |
| --- | --- |
| Server-Tests | `npm test` |
| Ein einzelner Server-Test | `npx vitest run tests/<datei>.test.ts` |
| Server-Typen | `npx tsc -b` |
| Manifest-Tests | `npm --prefix web/manifest test` |
| Manifest-Typen | `npm --prefix web/manifest exec tsc -b` |

---

## Dateiübersicht

**Neu**

| Datei | Verantwortung |
| --- | --- |
| `src/server/version.ts` | Kennt die eigene Version. Sonst nichts. |
| `src/server/update/github.ts` | Release abfragen, Versionen vergleichen, Antwort validieren. Kein Dateisystem. |
| `src/server/update/state.ts` | Der Zustand und seine Übergänge. Kein Netz, kein Dateisystem. |
| `src/server/update/download.ts` | Beide Dateien laden, sha256 prüfen. Kein Prozesswissen. |
| `src/server/update/install.ts` | Umbenennen, starten, prüfen, zurückrollen. |
| `src/server/routes/update.ts` | HTTP davor, inkl. `isLocal`-Grenze. |
| `scripts/build-server.mjs` | esbuild mit `__APP_VERSION__`-Define. |
| `scripts/check-version-tag.mjs` | Build abbrechen, wenn Tag ≠ `package.json`. |
| `web/manifest/src/markdown.tsx` | Die Release-Notes als React-Elemente. |
| `web/manifest/src/Update.tsx` | Der Update-Schirm. |
| `web/manifest/src/UpdateDialog.tsx` | Das Modal beim ersten Manifest-Aufruf. |
| `tests/updateGithub.test.ts`, `tests/updateState.test.ts`, `tests/updateDownload.test.ts`, `tests/updateInstall.test.ts`, `tests/update-route.test.ts`, `tests/checkVersionTag.test.ts` | Server-Tests |
| `web/manifest/src/markdown.test.tsx`, `web/manifest/src/Update.test.tsx`, `web/manifest/src/UpdateDialog.test.tsx` | Manifest-Tests |

**Geändert:** `src/server/index.ts`, `src/server/main.ts`, `package.json`,
`web/manifest/src/api.ts`, `web/manifest/src/useEvents.ts`,
`web/manifest/src/setupTests.ts`, `web/manifest/src/App.tsx`,
`web/manifest/src/App.test.tsx`, `web/manifest/src/index.css`, `build.md`.

**Reihenfolge.** Task 1–7 sind der Server und bauen aufeinander auf. Task 8–11
sind das Manifest; sie brauchen nur die Typen aus Task 4. Task 12 schließt ab.

---

## Task 1: Das Programm kennt seine eigene Version

**Files:**
- Create: `src/server/version.ts`
- Create: `scripts/build-server.mjs`
- Create: `scripts/check-version-tag.mjs`
- Create: `tests/checkVersionTag.test.ts`
- Modify: `package.json` (Scripts `build:server` und `build:exe`)

**Interfaces:**
- Consumes: nichts.
- Produces: `APP_VERSION: string` aus `src/server/version.ts`. Alle späteren
  Tasks lesen die eigene Version ausschließlich hierüber.

### Warum

Nichts im gepackten Exe liest heute `package.json`, und
`scripts/patch-version-info.mjs` lässt Nodes Versionsnummern bewusst stehen.
Ohne eine Zahl, der man trauen kann, vergleicht der Updater Lügen.

- [ ] **Step 1: Write the failing test**

`tests/checkVersionTag.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
// @ts-expect-error - build script, plain .mjs without type declarations
import { versionMismatch } from '../scripts/check-version-tag.mjs'

describe('check-version-tag', () => {
  it('accepts a tag that carries exactly the package version', () => {
    expect(versionMismatch('1.2.0', 'v1.2.0')).toBeNull()
  })

  it('accepts a tag written without the leading v', () => {
    expect(versionMismatch('1.2.0', '1.2.0')).toBeNull()
  })

  // The whole point: a release tagged v1.2.0 whose binary says 1.1.0 makes
  // every later version comparison wrong, in a way nobody notices until an
  // update loop starts.
  it('names both numbers when they disagree', () => {
    expect(versionMismatch('1.1.0', 'v1.2.0')).toMatch(/1\.1\.0.*1\.2\.0/)
  })

  // A working copy that sits on no tag at all is the normal state during
  // development — the build must not demand one.
  it('accepts no tag at all', () => {
    expect(versionMismatch('1.1.0', null)).toBeNull()
  })
})
```

**Der reine Vergleich reicht nicht.** Die Zeile, die tatsächlich entscheidet,
ob der Build abbricht, ist der Main-Module-Guard am Ende des Skripts — und
genau dort saß in der ersten Fassung dieses Plans ein Fehler, den kein Test
gesehen hat, weil keiner das Skript als Prozess gestartet hat. Also zusätzlich
ein Test, der `check-version-tag.mjs` per `execFileSync` in einem frisch
angelegten Git-Repo unter `os.tmpdir()` laufen lässt und den **Exit-Code**
prüft:

- Version passt zum Tag auf HEAD → Exit 0
- Version passt nicht → Exit ≠ 0, und stderr nennt beide Zahlen
- HEAD trägt gar keinen Tag → Exit 0

Die Fixture-Commits brauchen `git -c user.email=… -c user.name=…`, damit der
Test nicht von der globalen Git-Konfiguration abhängt.

Dazu `tests/version.test.ts` für `src/server/version.ts`: `fromPackageJson`
liest aus `process.cwd()` — ein Verzeichniswechsel im Test treibt beide Fälle,
die lesbare `package.json` und den Rückfall auf `'0.0.0'` bei fehlender oder
kaputter Datei.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/checkVersionTag.test.ts`
Expected: FAIL — `Cannot find module '../scripts/check-version-tag.mjs'`

- [ ] **Step 3: Write `scripts/check-version-tag.mjs`**

```js
// The version inside the binary and the tag a release is published under must
// be the same number. If they drift, the updater compares the tag on GitHub
// against a different number in the running exe — an update that reinstalls
// itself forever, or one that never appears at all.
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The message to abort with, or null when everything lines up. */
export function versionMismatch(pkgVersion, tag) {
  // No tag: an ordinary development build. Nothing to compare against.
  if (!tag) return null
  const tagged = tag.startsWith('v') ? tag.slice(1) : tag
  if (tagged === pkgVersion) return null
  return (
    `package.json sagt ${pkgVersion}, der Git-Tag sagt ${tagged}.\n` +
    `Entweder die Version in package.json anheben oder den Tag korrigieren — ` +
    `sonst trägt das Release eine andere Zahl als das Binary.`
  )
}

/** The tag pointing exactly at HEAD, or null when HEAD carries none. */
export function currentTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--exact-match'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

// pathToFileURL, not a hand-built `file://` + slash swap: on Windows the latter
// produces `file://C:/…` where import.meta.url is `file:///C:/…`, so the guard
// never fires, the check never runs, and build:exe exits 0 through any
// mismatch — silently. Measured on Windows 11 / Node 24 before this was fixed.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const problem = versionMismatch(pkg.version, currentTag())
  if (problem) {
    console.error(`\nERROR: ${problem}\n`)
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/checkVersionTag.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `src/server/version.ts`**

```ts
import fs from 'fs'
import path from 'path'

// Replaced at bundle time by scripts/build-server.mjs. esbuild substitutes the
// identifier textually, so it simply does not exist in a dev run via tsx —
// hence the typeof guard rather than a truthiness check.
declare const __APP_VERSION__: string

function fromPackageJson(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    // A dev run started from somewhere else. The version only decides whether
    // an update is offered, and the dev run never updates itself anyway.
    return '0.0.0'
  }
}

/** The version this build is. The number a GitHub release tag is compared to. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'undefined' ? fromPackageJson() : __APP_VERSION__
```

- [ ] **Step 6: Write `scripts/build-server.mjs`**

Replaces the inline esbuild call. Flags stay byte-for-byte what `package.json`
had, so the bundle does not change shape:

```js
// Bundles the server AND stamps the version into it. The version cannot come
// from package.json at runtime: the packaged exe has no package.json next to
// it, and reading one out of pkg's snapshot would report the build machine's
// checkout, not this build.
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['better-sqlite3'],
  outfile: path.join(root, 'dist/server.cjs'),
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})

console.log(`[tandem] dist/server.cjs gebaut, Version ${pkg.version}`)
```

- [ ] **Step 7: Point `package.json` at both scripts**

```jsonc
"build:server": "node scripts/build-server.mjs",
"build:exe": "node scripts/check-version-tag.mjs && node scripts/check-native-binary.mjs && node scripts/build-exe.mjs && node scripts/patch-subsystem.mjs && node scripts/patch-version-info.mjs && node scripts/copy-native-binary.mjs",
```

- [ ] **Step 8: Verify the bundle still builds**

Run: `npm run build:server`
Expected: `[tandem] dist/server.cjs gebaut, Version 1.1.0`, and `dist/server.cjs`
is written.

Dass die Zahl auch *im* Bundle landet, lässt sich hier noch nicht prüfen:
esbuild liest nur Dateien, die vom Einstiegspunkt aus erreichbar sind, und
`version.ts` importiert bis Task 4 niemand. Der `define` hat also noch nichts
zu ersetzen. Die Prüfung steht in Task 4, Step 7 — dort importiert
`routes/update.ts` als erster `APP_VERSION`.

- [ ] **Step 9: Run the whole server suite and the type check**

Run: `npm test && npx tsc -b`
Expected: all green, no type errors.

- [ ] **Step 10: Commit**

```bash
git add src/server/version.ts scripts/build-server.mjs scripts/check-version-tag.mjs tests/checkVersionTag.test.ts package.json
git commit -m "feat(update): das Programm kennt seine eigene Version"
```

---

## Task 2: Das neueste Release abfragen

**Files:**
- Create: `src/server/update/github.ts`
- Create: `tests/updateGithub.test.ts`

**Interfaces:**
- Consumes: `APP_VERSION` (Task 1).
- Produces:
  ```ts
  /** GitHub's /releases/latest, or process.env.TANDEM_RELEASE_URL when set. */
  export const RELEASE_URL: string
  export const EXE_NAME = 'tandem.exe'
  export const NATIVE_NAME = 'better_sqlite3.node'
  export interface ReleaseAsset { name: string; url: string; size: number; sha256: string }
  export interface Release { version: string; notes: string; exe: ReleaseAsset; native: ReleaseAsset }
  export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
  /** null = the two cannot be ranked (a version part this cannot parse). */
  export function compareVersions(a: string, b: string): number | null
  export function parseRelease(payload: unknown): Release | null
  export function fetchLatestRelease(fetcher?: Fetcher): Promise<Release | null>
  ```

### Warum

`/releases/latest` blendet Entwürfe und Vorabversionen selbst aus. Alles
andere — die Tag-Schreibweise, fehlende Assets, ein fehlender Digest — muss
hier abgefangen werden, sonst landet Müll im Zustand.

- [ ] **Step 1: Write the failing test**

`tests/updateGithub.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import {
  compareVersions, parseRelease, fetchLatestRelease, RELEASE_URL,
} from '../src/server/update/github'

/** A release payload shaped exactly like the real one (see `gh release view v1.1.0 --json`). */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.0',
    body: '## Kassieren\n\nMehrere Tandems auf einmal.',
    assets: [
      {
        name: 'tandem.exe', size: 114510588,
        browser_download_url: 'https://example.invalid/tandem.exe',
        digest: 'sha256:1b6e3732e2c80894acaec2fc9661684b1f5f72bc6c73093978d8c225667ef783',
      },
      {
        name: 'better_sqlite3.node', size: 1919488,
        browser_download_url: 'https://example.invalid/better_sqlite3.node',
        digest: 'sha256:e75b8c024a85179d8e0e51203a8b8867916e9a51327ce3953db5f8483cc9a91e',
      },
    ],
    ...overrides,
  }
}

describe('compareVersions', () => {
  it('orders by number, not by string', () => {
    // '10' < '9' as a string. This is why there is a function at all.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('reports equal versions as equal', () => {
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
  })

  it('treats a missing part as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
})

describe('parseRelease', () => {
  it('reads version, notes and both assets', () => {
    const release = parseRelease(payload())
    expect(release).not.toBeNull()
    expect(release!.version).toBe('1.2.0')
    expect(release!.notes).toContain('Kassieren')
    expect(release!.exe.size).toBe(114510588)
    expect(release!.native.url).toBe('https://example.invalid/better_sqlite3.node')
    expect(release!.exe.sha256).toHaveLength(64)
  })

  // The exe and the .node must come from the same build: the native binary is
  // compiled against the build machine's Node ABI, and the exe embeds that same
  // Node. A release carrying only one of them is not installable.
  it('refuses a release without the native binary', () => {
    const assets = payload().assets.filter((a) => a.name === 'tandem.exe')
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  it('refuses an asset without a sha256 digest', () => {
    const assets = payload().assets.map((a) => ({ ...a, digest: null }))
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  it('refuses a tag that is not a version', () => {
    expect(parseRelease(payload({ tag_name: 'nightly' }))).toBeNull()
  })

  it('refuses anything that is not a release object', () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('boom')).toBeNull()
  })
})

describe('RELEASE_URL', () => {
  it('is GitHub by default', () => {
    expect(RELEASE_URL).toContain('api.github.com')
  })

  // The manual staging test (build.md) points a real packaged exe at a fake
  // release on 127.0.0.1. Without this it would have to edit the source and
  // remember to change it back before the next build.
  it('can be pointed elsewhere for the staging test', async () => {
    vi.stubEnv('TANDEM_RELEASE_URL', 'http://127.0.0.1:8099/latest')
    vi.resetModules()
    const fresh = await import('../src/server/update/github')
    expect(fresh.RELEASE_URL).toBe('http://127.0.0.1:8099/latest')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('fetchLatestRelease', () => {
  it('asks GitHub for the latest release', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => payload(),
    })
    const release = await fetchLatestRelease(fetcher)
    expect(fetcher).toHaveBeenCalledWith(RELEASE_URL)
    expect(release!.version).toBe('1.2.0')
  })

  // A landing site without internet is the normal case, not the failure case.
  it('answers null when the network is gone', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    await expect(fetchLatestRelease(fetcher)).resolves.toBeNull()
  })

  it('answers null on a rate limit', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({}),
    })
    await expect(fetchLatestRelease(fetcher)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/updateGithub.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/update/github"`

- [ ] **Step 3: Write `src/server/update/github.ts`**

```ts
const GITHUB_LATEST =
  'https://api.github.com/repos/MarkusSeiberl/Tandem-Registration/releases/latest'

// Overridable so the manual staging test (build.md) can point a real packaged
// exe at a fake release on 127.0.0.1 — without editing this file and having to
// remember to change it back before a build goes out. Unset in every normal run.
export const RELEASE_URL = process.env.TANDEM_RELEASE_URL || GITHUB_LATEST

// The two files a release must carry. Exactly these names — copy-native-binary
// and build-exe produce them, and install.ts renames them in place.
export const EXE_NAME = 'tandem.exe'
export const NATIVE_NAME = 'better_sqlite3.node'

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** Lowercase hex, 64 characters. The `sha256:` prefix is stripped here. */
  sha256: string
}

export interface Release {
  version: string
  notes: string
  exe: ReleaseAsset
  native: ReleaseAsset
}

export type Fetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * Numeric comparison over three parts. Written out rather than pulled in: '10'
 * sorts before '9' as a string, and that is the only thing a version compare
 * has to get right here. Missing parts count as zero.
 */
/**
 * A dotted-version part that is a plain non-negative integer, e.g. "0", "12".
 * Anything else ("0-beta", "x", "1e3") is not a version this program knows how
 * to rank — returns null rather than throwing; see compareVersions.
 */
function toPart(part: string | undefined): number | null {
  // A part that is simply absent (the shorter of two dotted strings) is not
  // malformed, it is just shorter. "1.2" vs "1.2.0" is a legitimate way to
  // spell the same version, so a missing trailing part counts as zero.
  if (part === undefined) return 0
  if (!/^\d+$/.test(part)) return null
  return Number(part)
}

/**
 * Numeric comparison, part by part. Written out rather than pulled in: '10'
 * sorts before '9' as a string, and that is the only thing a version compare
 * has to get right here. Missing trailing parts count as zero; the parts are
 * compared out to the length of the longer operand, so a stray extra segment
 * (e.g. "1.2.0.5") is never silently dropped.
 *
 * Returns `null`, never throws, when either version carries a part it cannot
 * rank. `null` means here what it means everywhere else in this module —
 * "nothing I would dare compare" — and putting it in the return type instead
 * of a thrown error makes the compiler, not a comment, force every caller to
 * handle it. That matters because `foundRelease` compares this against
 * APP_VERSION, which is unvalidated input straight out of package.json.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  const na: (number | null)[] = []
  const nb: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    na.push(toPart(pa[i]))
    nb.push(toPart(pb[i]))
  }
  // Both operands are validated in full BEFORE anything is compared. An
  // earlier version returned on the first difference, which meant a malformed
  // part sitting after it was never reached: compareVersions('2.0.0', '1.x.0')
  // answered 1 instead of null, and the doc promise above was simply untrue.
  // A caller cannot compensate for that — the guarantee has to live here.
  if (na.some((n) => n === null) || nb.some((n) => n === null)) return null
  for (let i = 0; i < len; i++) {
    const diff = (na[i] as number) - (nb[i] as number)
    if (diff !== 0) return diff
  }
  return 0
}

function asAsset(raw: unknown): ReleaseAsset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>
  const digest = typeof a.digest === 'string' ? a.digest : ''
  if (!digest.startsWith('sha256:')) return null
  const sha256 = digest.slice('sha256:'.length).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null
  if (typeof a.name !== 'string') return null
  if (typeof a.browser_download_url !== 'string') return null
  // This URL gets fetched and the result executed in place of the running
  // program. `fetch` already refuses non-http(s) schemes and the URL comes from
  // GitHub's TLS-protected API, so this closes no live hole — but a trust
  // boundary is the place to require the transport we actually expect. TLS for
  // anything reachable over a network; plain HTTP only on loopback, where the
  // manual staging test (Task 12) serves a fake release from a throwaway local
  // server. Requiring TLS there would mean a self-signed certificate that
  // Node's `fetch` rejects anyway, so the test would simply never be run, and
  // loopback traffic never leaves the machine — there is no transport there to
  // downgrade.
  let downloadUrl: URL
  try {
    downloadUrl = new URL(a.browser_download_url)
  } catch {
    return null
  }
  // WHATWG URL keeps the brackets on an IPv6 host: `new URL('http://[::1]/x')
  // .hostname` is the literal string "[::1]", not "::1" (measured, Node 24).
  // Both spellings are accepted in case that ever differs across environments.
  const isLoopbackHost = downloadUrl.hostname === 'localhost'
    || downloadUrl.hostname === '127.0.0.1'
    || downloadUrl.hostname === '::1'
    || downloadUrl.hostname === '[::1]'
  const isSecure = downloadUrl.protocol === 'https:'
  const isLoopbackHttp = downloadUrl.protocol === 'http:' && isLoopbackHost
  if (!isSecure && !isLoopbackHttp) return null
  if (typeof a.size !== 'number' || a.size <= 0) return null
  return { name: a.name, url: a.browser_download_url, size: a.size, sha256 }
}

/**
 * Turns a GitHub release payload into something installable, or null.
 *
 * Null is not an error: it is "there is nothing here I would dare install".
 * Every caller treats it as "no update" and says nothing to the operator.
 */
export function parseRelease(payload: unknown): Release | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const tag = typeof p.tag_name === 'string' ? p.tag_name : ''
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) return null

  const assets = Array.isArray(p.assets) ? p.assets.map(asAsset) : []
  const exe = assets.find((a) => a?.name === EXE_NAME) ?? null
  const native = assets.find((a) => a?.name === NATIVE_NAME) ?? null
  // Both or nothing — see the ABI note in the design doc.
  if (!exe || !native) return null

  return { version, notes: typeof p.body === 'string' ? p.body : '', exe, native }
}

/**
 * The one network call this program makes. Unauthenticated (60/h per IP; we
 * use 24/day), 5 s, no retry: a drop zone without internet must not wait.
 */
export async function fetchLatestRelease(fetcher?: Fetcher): Promise<Release | null> {
  const get: Fetcher =
    fetcher ??
    ((url) =>
      fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'tandem-updater',
        },
        signal: AbortSignal.timeout(5000),
      }))
  try {
    const res = await get(RELEASE_URL)
    if (!res.ok) {
      console.error(`[tandem] Update-Abfrage: HTTP ${res.status}`)
      return null
    }
    return parseRelease(await res.json())
  } catch (err) {
    console.error('[tandem] Update-Abfrage fehlgeschlagen:', err)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/updateGithub.test.ts`
Expected: PASS, 27 tests (die Liste oben ist der Kern; der Loopback-, Sentinel- und Kurzschluss-Fix aus den Reviews hat sie erweitert).
Sentinel-Fix aus dem Review hat sie auf 24 erweitert).

- [ ] **Step 5: Commit**

```bash
git add src/server/update/github.ts tests/updateGithub.test.ts
git commit -m "feat(update): das neueste Release abfragen und pruefen"
```

---

## Task 3: Der Zustand

**Files:**
- Create: `src/server/update/state.ts`
- Create: `tests/updateState.test.ts`

**Interfaces:**
- Consumes: `Release`, `compareVersions` (Task 2).
- Produces:
  ```ts
  export type UpdatePhase =
    | 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'check-failed'
    | 'available' | 'downloading' | 'verifying' | 'ready'
    | 'download-failed' | 'installing' | 'install-failed'

  export interface UpdateStatus {
    phase: UpdatePhase
    currentVersion: string
    latestVersion: string | null
    notes: string | null
    downloadedBytes: number
    totalBytes: number
    error: string | null
    checkedAt: string | null
  }

  export class UpdateState {
    constructor(currentVersion: string, phase?: UpdatePhase)
    get(): UpdateStatus
    get promptPending(): boolean
    onChange(listener: (s: UpdateStatus) => void): void
    patch(fields: Partial<UpdateStatus>): void
    beginCheck(): void
    foundRelease(release: Release | null, isStartup: boolean): void
    markPromptSeen(): void
    fail(phase: UpdatePhase, message: string): void
    readonly release: Release | null  // getter, set only by foundRelease
  }
  ```

### Warum

Der Zustand ist die einzige Wahrheit, aus der Dialog, Sidebar-Eintrag und
Update-Schirm lesen. Die eine Regel, die er allein kennt: **nur die erste,
beim Start ausgelöste Abfrage darf das Modal scharfschalten.** Ein Fund aus der
stündlichen Abfrage lässt bloß den Sidebar-Eintrag angehen — ein Modal über
einem halb ausgefüllten Manifest um 14 Uhr ist der schlechteste Moment.

- [ ] **Step 1: Write the failing test**

`tests/updateState.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { UpdateState } from '../src/server/update/state'
import type { Release } from '../src/server/update/github'

const release = (version: string): Release => ({
  version,
  notes: '## Neu\n\nEtwas.',
  exe: { name: 'tandem.exe', url: 'u', size: 10, sha256: 'a'.repeat(64) },
  native: { name: 'better_sqlite3.node', url: 'u', size: 2, sha256: 'b'.repeat(64) },
})

describe('UpdateState', () => {
  it('starts idle and knows its own version', () => {
    const state = new UpdateState('1.1.0')
    expect(state.get().phase).toBe('idle')
    expect(state.get().currentVersion).toBe('1.1.0')
    expect(state.promptPending).toBe(false)
  })

  it('reports a newer release as available, with notes', () => {
    const state = new UpdateState('1.1.0')
    state.beginCheck()
    expect(state.get().phase).toBe('checking')
    state.foundRelease(release('1.2.0'), true)
    expect(state.get().phase).toBe('available')
    expect(state.get().latestVersion).toBe('1.2.0')
    expect(state.get().notes).toContain('Neu')
    expect(state.get().checkedAt).not.toBeNull()
  })

  it('reports the same version as up to date and keeps no release', () => {
    const state = new UpdateState('1.2.0')
    state.beginCheck()
    state.foundRelease(release('1.2.0'), true)
    expect(state.get().phase).toBe('up-to-date')
    expect(state.release).toBeNull()
  })

  it('never offers a downgrade', () => {
    const state = new UpdateState('2.0.0')
    state.beginCheck()
    state.foundRelease(release('1.9.9'), true)
    expect(state.get().phase).toBe('up-to-date')
  })

  it('reports a failed query without an error text on the screen', () => {
    const state = new UpdateState('1.1.0')
    state.beginCheck()
    state.foundRelease(null, true)
    expect(state.get().phase).toBe('check-failed')
    expect(state.get().error).toBeNull()
  })

  // The single rule only this class knows.
  it('arms the dialog on the startup check only', () => {
    const startup = new UpdateState('1.1.0')
    startup.beginCheck()
    startup.foundRelease(release('1.2.0'), true)
    expect(startup.promptPending).toBe(true)

    const hourly = new UpdateState('1.1.0')
    hourly.beginCheck()
    hourly.foundRelease(release('1.2.0'), false)
    expect(hourly.promptPending).toBe(false)
    expect(hourly.get().phase).toBe('available')
  })

  it('disarms the dialog once it has been shown', () => {
    const state = new UpdateState('1.1.0')
    state.beginCheck()
    state.foundRelease(release('1.2.0'), true)
    state.markPromptSeen()
    expect(state.promptPending).toBe(false)
  })

  it('tells its listeners on every change', () => {
    const state = new UpdateState('1.1.0')
    const seen = vi.fn()
    state.onChange(seen)
    state.beginCheck()
    state.patch({ phase: 'downloading', downloadedBytes: 5, totalBytes: 10 })
    expect(seen).toHaveBeenCalledTimes(2)
    expect(seen.mock.calls[1][0].downloadedBytes).toBe(5)
  })

  it('carries a failure message for the screen', () => {
    const state = new UpdateState('1.1.0')
    state.fail('download-failed', 'Prüfsumme stimmt nicht.')
    expect(state.get().phase).toBe('download-failed')
    expect(state.get().error).toBe('Prüfsumme stimmt nicht.')
  })

  it('stays disabled when built that way', () => {
    const state = new UpdateState('1.1.0', 'disabled')
    expect(state.get().phase).toBe('disabled')
  })

  // compareVersions answers null for a version part it cannot parse, and
  // APP_VERSION comes out of package.json unvalidated. A build mistake must not
  // take the jump day down, and must not leave the state stuck in 'checking' —
  // the sidebar entry and the dialog both wait on a resolved phase.
  it('survives an unparsable local version', () => {
    const state = new UpdateState('1.2.0-beta')
    state.beginCheck()
    expect(() => state.foundRelease(release('1.3.0'), true)).not.toThrow()
    expect(state.get().phase).toBe('check-failed')
    expect(state.promptPending).toBe(false)
    expect(state.release).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/updateState.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/update/state"`

- [ ] **Step 3: Write `src/server/update/state.ts`**

```ts
import { compareVersions } from './github'
import type { Release } from './github'

export type UpdatePhase =
  | 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'check-failed'
  | 'available' | 'downloading' | 'verifying' | 'ready'
  | 'download-failed' | 'installing' | 'install-failed'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  notes: string | null
  downloadedBytes: number
  totalBytes: number
  /** Only ever set for something the operator can act on. Never for a lost network. */
  error: string | null
  checkedAt: string | null
}

export class UpdateState {
  private status: UpdateStatus
  private listeners: ((s: UpdateStatus) => void)[] = []
  private promptArmed = false
  private found: Release | null = null

  /**
   * The release the download and install steps work from. Read-only from
   * outside: it is set only by foundRelease, so nothing can point the
   * downloader at something this class never approved.
   */
  get release(): Release | null {
    return this.found
  }

  constructor(currentVersion: string, phase: UpdatePhase = 'idle') {
    this.status = {
      phase, currentVersion, latestVersion: null, notes: null,
      downloadedBytes: 0, totalBytes: 0, error: null, checkedAt: null,
    }
  }

  get(): UpdateStatus {
    return { ...this.status }
  }

  get promptPending(): boolean {
    return this.promptArmed
  }

  onChange(listener: (s: UpdateStatus) => void): void {
    this.listeners.push(listener)
  }

  patch(fields: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...fields }
    for (const l of this.listeners) l(this.get())
  }

  beginCheck(): void {
    this.patch({ phase: 'checking' })
  }

  /**
   * `isStartup` decides one thing and one thing only: whether the manifest is
   * allowed to open a modal about this find. The hourly check passes false, so
   * a release published at noon lights the sidebar and nothing else.
   */
  foundRelease(release: Release | null, isStartup: boolean): void {
    const checkedAt = new Date().toISOString()
    if (!release) {
      // Clear the handle too, not just the phase: the download step reads
      // `release` and does not gate on phase, so a release left over from an
      // earlier successful check would still be fetchable after a later check
      // found nothing.
      this.forget()
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    // compareVersions answers null when it cannot compare the two. The release
    // tag is already gated by parseRelease's regex; the other operand is
    // APP_VERSION out of package.json and is not. A malformed local version is
    // a build mistake, not something the operator can fix at the landing site,
    // so it must never take the jump day down or strand the state in
    // 'checking' — it becomes an ordinary failed check, loud in the log.
    const newer = compareVersions(release.version, this.status.currentVersion)
    if (newer === null) {
      console.error(
        `[tandem] Versionsvergleich nicht möglich: "${release.version}" gegen ` +
          `"${this.status.currentVersion}".`,
      )
      this.forget()
      this.patch({ phase: 'check-failed', checkedAt, error: null })
      return
    }
    if (newer <= 0) {
      this.forget()
      // error: null as well — a message left over from a failed download would
      // otherwise sit on an up-to-date status, looking like something the
      // operator still has to do.
      this.patch({
        phase: 'up-to-date', latestVersion: release.version, checkedAt, error: null,
      })
      return
    }
    this.found = release
    if (isStartup) this.promptArmed = true
    this.patch({
      phase: 'available', latestVersion: release.version, notes: release.notes,
      checkedAt, error: null, downloadedBytes: 0, totalBytes: 0,
    })
  }

  markPromptSeen(): void {
    this.promptArmed = false
  }

  /**
   * There is nothing installable any more. Drops the handle the downloader
   * works from AND any armed dialog: leaving the dialog armed while `release`
   * is gone would open a modal offering a version the download step then
   * silently refuses to fetch — a dead end with no feedback.
   */
  private forget(): void {
    this.found = null
    this.promptArmed = false
  }

  fail(phase: UpdatePhase, message: string): void {
    this.patch({ phase, error: message })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/updateState.test.ts`
Expected: PASS, 14 tests (die Liste oben plus die Tests aus den Reviews: nicht vergleichbare Version, veralteter Release-Griff, alte Fehlermeldung, entschaerfter Dialog).

- [ ] **Step 5: Commit**

```bash
git add src/server/update/state.ts tests/updateState.test.ts
git commit -m "feat(update): Zustand des Updates mit einmaligem Start-Dialog"
```

---

## Task 4: Die Routen

**Files:**
- Create: `src/server/routes/update.ts`
- Create: `src/server/routes/isLocal.ts` (aus `shutdown.ts` herausgezogen, von
  beiden benutzt)
- Modify: `src/server/routes/shutdown.ts` (benutzt jetzt das geteilte `isLocal`)
- Create: `tests/update-route.test.ts`
- Modify: `src/server/index.ts` (Import, 8. Parameter, `registerUpdateRoutes`)
- Modify: `tests/helpers/testServer.ts` (8. Parameter durchreichen)

**Interfaces:**
- Consumes: `UpdateState`, `UpdateStatus` (Task 3), `APP_VERSION` (Task 1).
- Produces:
  ```ts
  export interface UpdateControls {
    state: UpdateState
    check: () => void
    download: () => void
    install: () => void
  }
  export function registerUpdateRoutes(
    app: FastifyInstance, db: Database, update?: UpdateControls,
  ): void
  export interface UpdateStatusResponse extends UpdateStatus {
    allowed: boolean
    promptPending: boolean
    openToday: number
  }
  ```
  `buildServer(..., shutdown?, update?)` — `update` ist der achte Parameter.

### Warum

Dieselbe Grenze wie `/api/shutdown`: das Manifest hat keine Anmeldung, jedes
Tablet im Vereins-WLAN kann es öffnen, und ein Update beendet den Sprungtag für
alle. `check`/`download`/`install` sind absichtlich `void` und nicht
`Promise` — die Route antwortet sofort und lässt die Arbeit laufen.

- [ ] **Step 1: Write the failing test**

`tests/update-route.test.ts`:

```ts
import { test, expect, vi } from 'vitest'
import { testServer } from './helpers/testServer'
import { UpdateState } from '../src/server/update/state'
import type { UpdateControls } from '../src/server/routes/update'

const REMOTE = '192.168.0.42'

function withUpdate(state = new UpdateState('1.1.0')) {
  const controls: UpdateControls = {
    state, check: vi.fn(), download: vi.fn(), install: vi.fn(),
  }
  return { ...testServer({}, undefined, undefined, undefined, controls), controls, state }
}

// Die Schranke wird tabellengetrieben geprüft, nicht stichprobenhaft: alle vier
// POST-Routen gegen alle drei Fälle (lokal erlaubt, LAN → 403, ohne Controls →
// 501). Geprüft wird die **Nebenwirkung**, nicht nur der Statuscode — eine
// Route, die 403 antwortet und die Aktion trotzdem ausführt, bestünde eine
// reine Statusprüfung. Eine an einer Route geprüfte und für die anderen drei
// angenommene Sicherheitskontrolle ist keine geprüfte Sicherheitskontrolle.
const ROUTES = [
  { url: '/api/update/check', code: 202, spy: (c: UpdateControls) => c.check },
  { url: '/api/update/download', code: 202, spy: (c: UpdateControls) => c.download },
  { url: '/api/update/install', code: 202, spy: (c: UpdateControls) => c.install },
  {
    url: '/api/update/prompt-seen', code: 204,
    spy: (c: UpdateControls) => vi.spyOn(c.state, 'markPromptSeen'),
  },
] as const

test('the status names both versions and is open to every device', async () => {
  const state = new UpdateState('1.1.0')
  state.patch({ phase: 'available', latestVersion: '1.2.0', notes: '## Neu' })
  const { app } = withUpdate(state)
  const res = await app.inject({ method: 'GET', url: '/api/update/status', remoteAddress: REMOTE })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({
    phase: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0', allowed: false,
  })
  await app.close()
})

test('only the machine the server runs on is allowed to act', async () => {
  const { app } = withUpdate()
  const local = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(local.json().allowed).toBe(true)
  await app.close()
})

test('a dev server reports itself disabled and refuses every action', async () => {
  const { app } = testServer()
  const status = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(status.json()).toMatchObject({ phase: 'disabled', allowed: false })
  for (const url of ['/api/update/check', '/api/update/download', '/api/update/install']) {
    const res = await app.inject({ method: 'POST', url })
    expect(res.statusCode).toBe(501)
  }
  await app.close()
})

test('a tablet cannot start a download', async () => {
  const { app, controls } = withUpdate()
  const res = await app.inject({
    method: 'POST', url: '/api/update/download', remoteAddress: REMOTE,
  })
  expect(res.statusCode).toBe(403)
  expect(controls.download).not.toHaveBeenCalled()
  await app.close()
})

test('the local machine starts check, download and install', async () => {
  const { app, controls } = withUpdate()
  for (const [url, fn] of [
    ['/api/update/check', controls.check],
    ['/api/update/download', controls.download],
    ['/api/update/install', controls.install],
  ] as const) {
    const res = await app.inject({ method: 'POST', url })
    expect(res.statusCode).toBe(202)
    expect(fn).toHaveBeenCalledTimes(1)
  }
  await app.close()
})

test('the dialog is pending once, then never again', async () => {
  const state = new UpdateState('1.1.0')
  state.foundRelease(
    {
      version: '1.2.0', notes: '',
      exe: { name: 'tandem.exe', url: 'u', size: 1, sha256: 'a'.repeat(64) },
      native: { name: 'better_sqlite3.node', url: 'u', size: 1, sha256: 'b'.repeat(64) },
    },
    true,
  )
  const { app } = withUpdate(state)
  expect((await app.inject({ method: 'GET', url: '/api/update/status' })).json().promptPending)
    .toBe(true)
  expect((await app.inject({ method: 'POST', url: '/api/update/prompt-seen' })).statusCode)
    .toBe(204)
  expect((await app.inject({ method: 'GET', url: '/api/update/status' })).json().promptPending)
    .toBe(false)
  await app.close()
})

// The restart warning has to name a number, and stitching two endpoints
// together in the browser would let them disagree.
test('the status counts the open tandems of today', async () => {
  const { app, db } = withUpdate()
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  db.prepare('INSERT INTO registrations (first_name, jump_date, paid_at) VALUES (?, ?, ?)')
    .run('Offen', iso, null)
  db.prepare('INSERT INTO registrations (first_name, jump_date, paid_at) VALUES (?, ?, ?)')
    .run('Kassiert', iso, '2026-09-21T10:00:00Z')
  db.prepare('INSERT INTO registrations (first_name, jump_date, paid_at) VALUES (?, ?, ?)')
    .run('Gestern', '2000-01-01', null)
  const res = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(res.json().openToday).toBe(1)
  await app.close()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/update-route.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/routes/update"`

- [ ] **Step 3: Write `src/server/routes/update.ts`**

```ts
import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { APP_VERSION } from '../version'
import { today } from '../day'
import { isLocal } from './isLocal'
import type { UpdateState, UpdateStatus } from '../update/state'

/**
 * What the routes are allowed to set in motion. Only the packaged exe hands
 * this in — it is the one build that owns its own files and its own process.
 */
export interface UpdateControls {
  state: UpdateState
  /** All three answer immediately and do their work afterwards. */
  check: () => void
  download: () => void
  install: () => void
}

export interface UpdateStatusResponse extends UpdateStatus {
  allowed: boolean
  promptPending: boolean
  openToday: number
}

// isLocal lives in its own module (src/server/routes/isLocal.ts) and is shared
// with routes/shutdown.ts, which draws the same line for the same reason: the
// manifest has no login and every device on the club WLAN can open it, so the
// server decides. `req.ip` is the socket's peer address — nothing a client can
// set about itself, and the app sets no `trustProxy`, so no request header can
// influence it. One copy, not two: a loopback form added to one of two
// byte-identical copies would leave the other silently weaker.

function openToday(db: Database): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM registrations WHERE jump_date = ? AND paid_at IS NULL')
    .get(today()) as { n: number }
  return row.n
}

export function registerUpdateRoutes(
  app: FastifyInstance,
  db: Database,
  update?: UpdateControls,
): void {
  app.get('/api/update/status', async (req): Promise<UpdateStatusResponse> => {
    const base: UpdateStatus = update
      ? update.state.get()
      : {
          phase: 'disabled', currentVersion: APP_VERSION, latestVersion: null,
          notes: null, downloadedBytes: 0, totalBytes: 0, error: null, checkedAt: null,
        }
    return {
      ...base,
      allowed: update !== undefined && isLocal(req.ip),
      // A getter on UpdateState, not on UpdateControls.
      promptPending: update?.state.promptPending ?? false,
      openToday: openToday(db),
    }
  })

  // The four actions share one gate, so a new one cannot forget it.
  function action(url: string, run: (c: UpdateControls) => void, code: number) {
    app.post(url, async (req, reply) => {
      if (!update) {
        return reply.code(501).send({ error: 'Updates sind auf diesem Server nicht eingerichtet.' })
      }
      if (!isLocal(req.ip)) {
        return reply.code(403).send({
          error: 'Updates sind nur an dem Rechner möglich, auf dem Tandem läuft.',
        })
      }
      reply.code(code).send(code === 204 ? undefined : { ok: true })
      run(update)
    })
  }

  action('/api/update/check', (c) => c.check(), 202)
  action('/api/update/download', (c) => c.download(), 202)
  action('/api/update/install', (c) => c.install(), 202)
  action('/api/update/prompt-seen', (c) => c.state.markPromptSeen(), 204)
}
```

- [ ] **Step 4: Wire it into `src/server/index.ts`**

Add the import and the eighth parameter:

```ts
import { registerUpdateRoutes } from './routes/update'
import type { UpdateControls } from './routes/update'
```

```ts
export function buildServer(
  db: Database,
  cfgRef: { current: Config },
  contractTemplate: Buffer,
  persist?: (c: Config) => void,
  notify?: (guestName: string) => void,
  pickPath?: PickPath,
  // Only the packaged exe passes this: it is the one build that owns its own
  // process and can end it cleanly (see main.ts).
  shutdown?: () => void,
  // Likewise: the one build that owns the files it runs from.
  update?: UpdateControls,
): FastifyInstance {
```

and, next to the other `register…` calls:

```ts
  registerUpdateRoutes(app, db, update)
```

- [ ] **Step 5: Let the test helper pass it through**

In `tests/helpers/testServer.ts`:

```ts
export function testServer(
  cfgOverrides: Partial<Config> = {},
  notify?: (guestName: string) => void,
  pickPath?: PickPath,
  shutdown?: () => void,
  update?: UpdateControls
) {
```

```ts
    app: buildServer(db, cfgRef, templateBytes, undefined, notify, pickPath, shutdown, update),
```

with `import type { UpdateControls } from '../../src/server/routes/update'` at the top.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/update-route.test.ts`
Expected: PASS â die tabellengetriebene Schrankenpruefung plus die Tests fuer Status-Nutzlast, openToday und die Dialog-Abfolge.

- [ ] **Step 7: Verify the version really lands in the bundle**

`routes/update.ts` ist der erste Importeur von `APP_VERSION`, also erreicht
esbuild `version.ts` ab jetzt und der `define` aus Task 1 hat etwas zu
ersetzen. Das ist die Prüfung, die in Task 1 noch nicht möglich war.

Run: `npm run build:server && node -e "const s=require('fs').readFileSync('dist/server.cjs','utf8'); console.log(s.includes('__APP_VERSION__') ? 'FAIL: define not substituted' : s.includes('1.1.0') ? 'VERSION IN BUNDLE' : 'FAIL: version missing')"`
Expected: `[tandem] dist/server.cjs gebaut, Version 1.1.0` then `VERSION IN BUNDLE`

- [ ] **Step 8: Run the whole suite — nothing else may move**

Run: `npm test && npx tsc -b`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/server/routes/update.ts src/server/index.ts tests/update-route.test.ts tests/helpers/testServer.ts
git commit -m "feat(update): Update-Routen hinter der localhost-Grenze"
```

---

## Task 5: Beide Dateien laden und prüfen

**Files:**
- Create: `src/server/update/download.ts`
- Create: `tests/updateDownload.test.ts`

**Interfaces:**
- Consumes: `Release`, `EXE_NAME`, `NATIVE_NAME` (Task 2).
- Produces:
  ```ts
  export interface DownloadDeps {
    dir: string
    fetchStream: (url: string) => Promise<NodeJS.ReadableStream>
    onProgress: (downloadedBytes: number, totalBytes: number) => void
    freeBytes?: (dir: string) => number
  }
  export const NEW_SUFFIX = '.new'
  export function downloadRelease(release: Release, deps: DownloadDeps): Promise<void>
  export function removePartials(dir: string): void
  ```

### Warum

Beide Dateien landen als `tandem.exe.new` und `better_sqlite3.node.new`
**neben dem laufenden Exe**, nicht im Temp-Ordner: das spätere Umbenennen muss
auf demselben Volume stattfinden, sonst ist es ein Kopieren, das mittendrin
scheitern kann. Der sha256 läuft im Stream mit; stimmt er nicht, fliegt alles
weg, bevor irgendetwas umbenannt wird.

- [ ] **Step 1: Write the failing test**

`tests/updateDownload.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { downloadRelease, removePartials } from '../src/server/update/download'
import type { Release } from '../src/server/update/github'

const EXE_BODY = Buffer.from('ich bin ein exe')
const NATIVE_BODY = Buffer.from('ich bin ein native binary')

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')

function release(overrides: Partial<Release> = {}): Release {
  return {
    version: '1.2.0',
    notes: '',
    exe: {
      name: 'tandem.exe', url: 'https://example.invalid/tandem.exe',
      size: EXE_BODY.length, sha256: sha(EXE_BODY),
    },
    native: {
      name: 'better_sqlite3.node', url: 'https://example.invalid/better_sqlite3.node',
      size: NATIVE_BODY.length, sha256: sha(NATIVE_BODY),
    },
    ...overrides,
  }
}

const bodies: Record<string, Buffer> = {
  'https://example.invalid/tandem.exe': EXE_BODY,
  'https://example.invalid/better_sqlite3.node': NATIVE_BODY,
}

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-dl-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const deps = (over: Partial<Parameters<typeof downloadRelease>[1]> = {}) => ({
  dir,
  fetchStream: async (url: string) => Readable.from([bodies[url]]),
  onProgress: vi.fn(),
  freeBytes: () => 1_000_000_000,
  ...over,
})

describe('downloadRelease', () => {
  it('writes both files with a .new suffix', async () => {
    await downloadRelease(release(), deps())
    expect(fs.readFileSync(path.join(dir, 'tandem.exe.new'))).toEqual(EXE_BODY)
    expect(fs.readFileSync(path.join(dir, 'better_sqlite3.node.new'))).toEqual(NATIVE_BODY)
  })

  it('never touches the files that are in use', async () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'die laufende Version')
    await downloadRelease(release(), deps())
    expect(fs.readFileSync(path.join(dir, 'tandem.exe'), 'utf8')).toBe('die laufende Version')
  })

  it('reports progress across both files together', async () => {
    const onProgress = vi.fn()
    await downloadRelease(release(), deps({ onProgress }))
    const last = onProgress.mock.calls.at(-1)!
    expect(last[0]).toBe(EXE_BODY.length + NATIVE_BODY.length)
    expect(last[1]).toBe(EXE_BODY.length + NATIVE_BODY.length)
  })

  // The one check that stands between the internet and an exe that gets started.
  it('throws and leaves nothing behind when a checksum does not match', async () => {
    const bad = release({
      exe: { ...release().exe, sha256: 'f'.repeat(64) },
    })
    await expect(downloadRelease(bad, deps())).rejects.toThrow(/Prüfsumme/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('refuses to start when the disk is nearly full', async () => {
    await expect(downloadRelease(release(), deps({ freeBytes: () => 10 })))
      .rejects.toThrow(/Speicherplatz/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('leaves nothing behind when the connection drops mid-file', async () => {
    const fetchStream = async () =>
      Readable.from((async function* () {
        yield Buffer.from('halb')
        throw new Error('ECONNRESET')
      })())
    await expect(downloadRelease(release(), deps({ fetchStream }))).rejects.toThrow()
    expect(fs.readdirSync(dir)).toEqual([])
  })
})

describe('removePartials', () => {
  it('deletes leftover .new files and nothing else', () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'x')
    fs.writeFileSync(path.join(dir, 'better_sqlite3.node.new'), 'x')
    fs.writeFileSync(path.join(dir, 'tandem.db'), 'wichtig')
    removePartials(dir)
    expect(fs.readdirSync(dir)).toEqual(['tandem.db'])
  })

  it('does nothing when there is nothing to clean up', () => {
    expect(() => removePartials(dir)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/updateDownload.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/update/download"`

- [ ] **Step 3: Write `src/server/update/download.ts`**

```ts
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
import { EXE_NAME, NATIVE_NAME } from './github'
import type { Release, ReleaseAsset } from './github'

/** Both files land beside the running exe under this suffix. */
export const NEW_SUFFIX = '.new'

export interface DownloadDeps {
  /** Where tandem.exe lives. The download MUST land on the same volume: the
   *  install step renames, and a rename across volumes is a copy that can fail
   *  halfway through, with the running exe already gone. */
  dir: string
  fetchStream: (url: string) => Promise<NodeJS.ReadableStream>
  onProgress: (downloadedBytes: number, totalBytes: number) => void
  freeBytes?: (dir: string) => number
}

function defaultFreeBytes(dir: string): number {
  // statfsSync throws (ENOENT for a missing dir, or a native error on a
  // filesystem that does not implement statfs) rather than returning a
  // sentinel. Uncaught, that is raw English Node text on the screen of an
  // operator whose exe has no console.
  //
  // Failing closed rather than reading "unknown" as "space is fine": `dir` is
  // where the running exe already lives, so a probe failure there means
  // something is wrong with that directory itself — and the same problem
  // would very likely break the write that follows. Better to refuse at once,
  // in German, naming the directory, than to spend a landing site's slow link
  // on a few hundred megabytes that fail for the same reason at the end.
  try {
    const st = fs.statfsSync(dir)
    return Number(st.bsize) * Number(st.bavail)
  } catch {
    throw new Error(`Freier Speicherplatz von „${dir}“ konnte nicht ermittelt werden.`)
  }
}

export async function defaultFetchStream(url: string): Promise<NodeJS.ReadableStream> {
  const res = await fetch(url, { headers: { 'User-Agent': 'tandem-updater' } })
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`)
  return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
}

/** Deletes every half-written download. Safe to call when there is none. */
export function removePartials(dir: string): void {
  for (const name of [EXE_NAME, NATIVE_NAME]) {
    fs.rmSync(path.join(dir, name + NEW_SUFFIX), { force: true })
  }
}

async function fetchAsset(
  asset: ReleaseAsset,
  deps: DownloadDeps,
  alreadyDone: number,
  total: number,
): Promise<number> {
  const target = path.join(deps.dir, asset.name + NEW_SUFFIX)
  const hash = crypto.createHash('sha256')
  let done = alreadyDone
  let lastReport = 0

  const source = await deps.fetchStream(asset.url)

  // Hashing happens inside the pipeline as a Transform, not via a parallel
  // 'data' listener on `source`. Attaching `.on('data', …)` switches a stream
  // into flowing mode immediately, and whether `pipeline()`'s own consumer is
  // wired up before the first chunk is emitted is a timing detail of Node's
  // stream internals, not a guarantee this code can lean on — if it lost that
  // race, bytes would reach the hash but never the file (or the other way
  // round), and a truncated file could still pass its own checksum. Routing
  // every byte through a Transform that both hashes and forwards makes that
  // impossible by construction: one consumer, and hashing and writing happen
  // on the same chunk in the same step.
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk)
      done += chunk.length
      // Throttled: a 114 MB file would otherwise push thousands of SSE frames
      // at every connected manifest.
      const now = Date.now()
      if (now - lastReport >= 500) {
        lastReport = now
        deps.onProgress(done, total)
      }
      callback(null, chunk)
    },
  })

  await pipeline(source, hasher, fs.createWriteStream(target))

  const got = hash.digest('hex')
  if (got !== asset.sha256) {
    throw new Error(
      `Prüfsumme von ${asset.name} stimmt nicht. Erwartet ${asset.sha256}, bekommen ${got}.`,
    )
  }
  deps.onProgress(done, total)
  return done
}

/**
 * Both files, or nothing. On any failure every partial file is removed, so the
 * install step can never find half a release lying around and install it.
 */
export async function downloadRelease(release: Release, deps: DownloadDeps): Promise<void> {
  const total = release.exe.size + release.native.size

  // Sweep BEFORE probing free space, not after: a run killed mid-download
  // (process killed, so the catch below never ran) leaves .new files behind,
  // and those must not survive into this attempt either way. Doing it first
  // also makes the check more accurate — the stale files are occupying
  // exactly the space it is about to measure.
  removePartials(deps.dir)

  const free = (deps.freeBytes ?? defaultFreeBytes)(deps.dir)
  // Twice over: the new files sit beside the old ones until the swap is done.
  if (free < total * 2) {
    throw new Error(
      `Zu wenig Speicherplatz: ${Math.round(total * 2 / 1e6)} MB nötig, ` +
        `${Math.round(free / 1e6)} MB frei.`,
    )
  }

  try {
    const afterExe = await fetchAsset(release.exe, deps, 0, total)
    await fetchAsset(release.native, deps, afterExe, total)
  } catch (err) {
    removePartials(deps.dir)
    throw err
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/updateDownload.test.ts`
Expected: PASS, 11 tests (die acht unten plus je einer fuer: zweite Datei scheitert nach erfolgreicher erster, fehlgeschlagene Platzmessung, und Reste werden auch bei Platzmangel weggeraeumt).

- [ ] **Step 5: Commit**

```bash
git add src/server/update/download.ts tests/updateDownload.test.ts
git commit -m "feat(update): beide Dateien laden und die Pruefsumme pruefen"
```

---

## Task 6: Tauschen, starten, zurückrollen

**Files:**
- Create: `src/server/update/install.ts`
- Create: `tests/updateInstall.test.ts`

**Interfaces:**
- Consumes: `EXE_NAME`, `NATIVE_NAME` (Task 2), `NEW_SUFFIX` (Task 5).
- Produces:
  ```ts
  export const OLD_EXE = 'tandem.old.exe'
  export const OLD_NATIVE = 'better_sqlite3.old.node'
  export const FAILURE_MARKER = 'update-failed.json'
  export interface InstallDeps {
    dir: string
    closeServer: () => Promise<void>
    spawnDetached: (exePath: string) => { kill: () => void }
    waitForHealth: (timeoutMs: number) => Promise<boolean>
    exit: (code: number) => void
    /** Default 90 s — an unsigned 114 MB exe can sit in a Defender scan first. */
    healthTimeoutMs?: number
  }
  export function installUpdate(deps: InstallDeps): Promise<void>
  export function cleanupLeftovers(dir: string): void
  export function takeFailureMarker(dir: string): string | null
  ```

### Warum

Die Reihenfolge ist das eigentliche Feature. Auf Windows 11 wurde vorher
nachgemessen, dass ein laufendes Exe umbenannt werden darf, dass an seinen
alten Pfad sofort geschrieben werden darf und dass auch das geladene
`better_sqlite3.node` umbenannt werden darf. Darum braucht es kein
Hilfsskript. Kommt die neue Version nicht hoch, werden beide `.old`-Dateien
zurückgeschoben und das **alte** Exe wieder gestartet — ein `app.close()` ist
endgültig, eine geschlossene Fastify-Instanz kann nicht erneut `listen()`.

- [ ] **Step 1: Write the failing test**

`tests/updateInstall.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  installUpdate, cleanupLeftovers, takeFailureMarker, OLD_EXE, OLD_NATIVE, FAILURE_MARKER,
} from '../src/server/update/install'

let dir: string

/** An install folder as it looks the moment the operator presses install. */
function stage() {
  fs.writeFileSync(path.join(dir, 'tandem.exe'), 'alt')
  fs.writeFileSync(path.join(dir, 'better_sqlite3.node'), 'alt-node')
  fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'neu')
  fs.writeFileSync(path.join(dir, 'better_sqlite3.node.new'), 'neu-node')
  fs.writeFileSync(path.join(dir, 'tandem.db'), 'der Sprungtag')
}

const deps = (over: Partial<Parameters<typeof installUpdate>[0]> = {}) => ({
  dir,
  closeServer: vi.fn().mockResolvedValue(undefined),
  spawnDetached: vi.fn().mockReturnValue({ kill: vi.fn() }),
  waitForHealth: vi.fn().mockResolvedValue(true),
  exit: vi.fn(),
  ...over,
})

const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8')
const has = (name: string) => fs.existsSync(path.join(dir, name))

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-inst-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('installUpdate — the happy path', () => {
  it('puts both new files in place and ends the old process', async () => {
    stage()
    const d = deps()
    await installUpdate(d)
    expect(read('tandem.exe')).toBe('neu')
    expect(read('better_sqlite3.node')).toBe('neu-node')
    expect(d.exit).toHaveBeenCalledWith(0)
  })

  it('closes the server before it renames anything', async () => {
    stage()
    const order: string[] = []
    const d = deps({
      closeServer: vi.fn(async () => { order.push('close') }),
      spawnDetached: vi.fn(() => { order.push('spawn'); return { kill: vi.fn() } }),
    })
    await installUpdate(d)
    expect(order).toEqual(['close', 'spawn'])
  })

  it('removes the rollback copies once the new version answers', async () => {
    stage()
    await installUpdate(deps())
    expect(has(OLD_EXE)).toBe(false)
    expect(has(OLD_NATIVE)).toBe(false)
  })

  it('leaves the database alone', async () => {
    stage()
    await installUpdate(deps())
    expect(read('tandem.db')).toBe('der Sprungtag')
  })

  // A leftover from an earlier, half-finished update would make the rename fail.
  it('clears a stale rollback copy before renaming', async () => {
    stage()
    fs.writeFileSync(path.join(dir, OLD_EXE), 'uralt')
    fs.writeFileSync(path.join(dir, OLD_NATIVE), 'uralt')
    await installUpdate(deps())
    expect(read('tandem.exe')).toBe('neu')
  })
})

describe('installUpdate — the new version does not come up', () => {
  it('puts both old files back and starts the old exe again', async () => {
    stage()
    const kill = vi.fn()
    const d = deps({
      waitForHealth: vi.fn().mockResolvedValue(false),
      spawnDetached: vi.fn().mockReturnValue({ kill }),
    })
    await installUpdate(d)
    expect(kill).toHaveBeenCalledTimes(1)
    expect(read('tandem.exe')).toBe('alt')
    expect(read('better_sqlite3.node')).toBe('alt-node')
    // Twice: once for the new version, once for the restored old one.
    expect(d.spawnDetached).toHaveBeenCalledTimes(2)
    expect(d.exit).toHaveBeenCalledWith(1)
  })

  it('leaves a reason behind for the restarted old version to show', async () => {
    stage()
    await installUpdate(deps({ waitForHealth: vi.fn().mockResolvedValue(false) }))
    expect(takeFailureMarker(dir)).toMatch(/nicht gestartet/)
  })

  it('refuses to start at all when a downloaded file is missing', async () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'alt')
    fs.writeFileSync(path.join(dir, 'better_sqlite3.node'), 'alt-node')
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'neu')
    const d = deps()
    await expect(installUpdate(d)).rejects.toThrow(/better_sqlite3\.node\.new/)
    expect(read('tandem.exe')).toBe('alt')
    expect(d.closeServer).not.toHaveBeenCalled()
  })
})

describe('cleanupLeftovers', () => {
  it('deletes rollback copies — this process running proves the new version starts', () => {
    fs.writeFileSync(path.join(dir, OLD_EXE), 'alt')
    fs.writeFileSync(path.join(dir, OLD_NATIVE), 'alt')
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'halb geladen')
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'laufend')
    cleanupLeftovers(dir)
    expect(fs.readdirSync(dir)).toEqual(['tandem.exe'])
  })

  it('does nothing on a folder that has never seen an update', () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'laufend')
    expect(() => cleanupLeftovers(dir)).not.toThrow()
    expect(has('tandem.exe')).toBe(true)
  })
})

describe('takeFailureMarker', () => {
  it('reads the reason once and removes the file', () => {
    fs.writeFileSync(path.join(dir, FAILURE_MARKER), JSON.stringify({ reason: 'kaputt' }))
    expect(takeFailureMarker(dir)).toBe('kaputt')
    expect(has(FAILURE_MARKER)).toBe(false)
    expect(takeFailureMarker(dir)).toBeNull()
  })

  it('survives a marker file somebody mangled', () => {
    fs.writeFileSync(path.join(dir, FAILURE_MARKER), 'kein JSON')
    expect(takeFailureMarker(dir)).toBeNull()
    expect(has(FAILURE_MARKER)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/updateInstall.test.ts`
Expected: FAIL — `Failed to resolve import "../src/server/update/install"`

- [ ] **Step 3: Write `src/server/update/install.ts`**

```ts
import fs from 'fs'
import path from 'path'
import { EXE_NAME, NATIVE_NAME } from './github'
import { NEW_SUFFIX } from './download'

export const OLD_EXE = 'tandem.old.exe'
export const OLD_NATIVE = 'better_sqlite3.old.node'
export const FAILURE_MARKER = 'update-failed.json'

export interface InstallDeps {
  dir: string
  /** Bonjour down, Fastify closed, database closed. */
  closeServer: () => Promise<void>
  spawnDetached: (exePath: string) => { kill: () => void }
  waitForHealth: (timeoutMs: number) => Promise<boolean>
  exit: (code: number) => void
  healthTimeoutMs?: number
}

const PAIRS: [live: string, old: string][] = [
  [EXE_NAME, OLD_EXE],
  [NATIVE_NAME, OLD_NATIVE],
]

/**
 * Everything an interrupted update can leave behind.
 *
 * Called at startup. That this process is running at all is the proof that the
 * version on disk starts, so the rollback copies have done their job — and it
 * also catches an old process that died before it could clean up itself.
 */
export function cleanupLeftovers(dir: string): void {
  for (const name of [OLD_EXE, OLD_NATIVE, EXE_NAME + NEW_SUFFIX, NATIVE_NAME + NEW_SUFFIX]) {
    fs.rmSync(path.join(dir, name), { force: true })
  }
}

/** Reads why the last attempt failed, exactly once. */
export function takeFailureMarker(dir: string): string | null {
  const file = path.join(dir, FAILURE_MARKER)
  if (!fs.existsSync(file)) return null
  let reason: string | null = null
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { reason?: unknown }
    if (typeof parsed.reason === 'string') reason = parsed.reason
  } catch {
    // A mangled marker is still a marker; the file goes either way so it
    // cannot reappear on every start.
  }
  fs.rmSync(file, { force: true })
  return reason
}

function restore(dir: string): void {
  for (const [live, old] of PAIRS) {
    const oldPath = path.join(dir, old)
    if (fs.existsSync(oldPath)) {
      fs.rmSync(path.join(dir, live), { force: true })
      fs.renameSync(oldPath, path.join(dir, live))
    }
  }
}

/**
 * Swaps both files and hands the port to the new process.
 *
 * Verified on Windows 11 before this was designed: a running exe can be
 * renamed, a new file can be written at its old path immediately, and a loaded
 * .node can be renamed too. That is why no helper script is needed.
 */
export async function installUpdate(deps: InstallDeps): Promise<void> {
  const { dir } = deps
  const exePath = path.join(dir, EXE_NAME)

  // Before anything is closed or moved: is there actually a full release here?
  for (const name of [EXE_NAME, NATIVE_NAME]) {
    const file = path.join(dir, name + NEW_SUFFIX)
    if (!fs.existsSync(file)) throw new Error(`${name + NEW_SUFFIX} fehlt — bitte neu laden.`)
  }

  await deps.closeServer()

  // From here the server is gone and nothing is listening. Every region below
  // must end in one of this module's two defined outcomes — the new version
  // running, or the old one restored and running. A third outcome, where an
  // unhandled throw leaves this process alive with a closed server and no
  // restart, is indistinguishable from a dead installation for an operator at
  // the landing site, and the caller cannot even report it: there is no server
  // left to report through. Hence the catch-all at the bottom.
  let child: { kill: () => void } | undefined
  try {
    // A leftover from an earlier attempt would make the rename below fail.
    for (const [, old] of PAIRS) fs.rmSync(path.join(dir, old), { force: true })

    try {
      for (const [live, old] of PAIRS) fs.renameSync(path.join(dir, live), path.join(dir, old))
      for (const [live] of PAIRS) {
        fs.renameSync(path.join(dir, live + NEW_SUFFIX), path.join(dir, live))
      }
    } catch (err) {
      restore(dir)
      fs.writeFileSync(
        path.join(dir, FAILURE_MARKER),
        JSON.stringify({ reason: `Dateien konnten nicht getauscht werden: ${String(err)}` }),
      )
      deps.spawnDetached(exePath)
      deps.exit(1)
      return
    }

    child = deps.spawnDetached(exePath)
    // 90 s, not 30: Windows Defender can scan a freshly written, unsigned 114 MB
    // binary before it is allowed to run. A genuinely broken exe fails in seconds
    // anyway, so the long wait only ever costs us in the rare real failure.
    const healthy = await deps.waitForHealth(deps.healthTimeoutMs ?? 90_000)

    if (healthy) {
      for (const [, old] of PAIRS) fs.rmSync(path.join(dir, old), { force: true })
      deps.exit(0)
      return
    }

    // The new version does not answer. Put everything back and start what we know
    // works — the operator must never be left with a dead installation.
    child.kill()
    restore(dir)
    fs.writeFileSync(
      path.join(dir, FAILURE_MARKER),
      JSON.stringify({
        reason:
          'Die neue Version ist nicht gestartet. Die vorherige Version wurde ' +
          'wiederhergestellt und läuft weiter.',
      }),
    )
    deps.spawnDetached(exePath)
    deps.exit(1)
  } catch (err) {
    // Anything unexpected past closeServer — the stale-.old sweep, spawnDetached,
    // or waitForHealth throwing instead of resolving to false — leaves the new
    // version's health unknown, and unknown falls back to the version known to
    // work. Deliberately tolerant of its OWN failures, each step wrapped alone:
    // if restore() or the marker write also throws, a best-effort restart of
    // whatever is on disk still beats an unhandled rejection with no server and
    // nothing running.
    try { child?.kill() } catch { /* best effort — see comment above */ }
    try { restore(dir) } catch { /* best effort — see comment above */ }
    try {
      fs.writeFileSync(
        path.join(dir, FAILURE_MARKER),
        JSON.stringify({
          reason: `Unerwarteter Fehler bei der Installation: „${String(err)}“. Die vorherige ` +
            'Version wurde, soweit möglich, wiederhergestellt und gestartet.',
        }),
      )
    } catch { /* best effort — see comment above */ }
    try { deps.spawnDetached(exePath) } catch { /* best effort — see comment above */ }
    deps.exit(1)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/updateInstall.test.ts`
Expected: PASS, 15 tests (12 aus der Liste unten plus je einer fuer einen Wurf aus dem .old-Sweep, aus spawnDetached und aus waitForHealth).

- [ ] **Step 5: Commit**

```bash
git add src/server/update/install.ts tests/updateInstall.test.ts
git commit -m "feat(update): Dateien tauschen, neu starten, bei Fehlschlag zurueckrollen"
```

---

## Task 7: Alles an `main.ts` hängen

**Files:**
- Modify: `src/server/main.ts`

**Interfaces:**
- Consumes: alles aus Task 1–6.
- Produces: der `UpdateControls`-Wert, den `buildServer` als achten Parameter
  bekommt — aber **nur** wenn `isPackaged`.

### Warum

Hier wird aus vier Modulen ein Feature: Aufräumen vor dem Start, Abfrage nach
`listen()`, stündlich danach, und die drei Aktionen, die das Manifest auslöst.
Alles hinter `isPackaged`, damit `npm start`, der Playwright-Lauf und die
Unit-Tests sich nie selbst aktualisieren.

- [ ] **Step 1: Add the imports**

Nach den vorhandenen Imports in `src/server/main.ts`:

```ts
import { spawn } from 'child_process'
import { APP_VERSION } from './version'
import { UpdateState } from './update/state'
import { fetchLatestRelease } from './update/github'
import { downloadRelease, defaultFetchStream, removePartials } from './update/download'
import { cleanupLeftovers, takeFailureMarker, installUpdate } from './update/install'
import type { UpdateControls } from './routes/update'
```

`exec` wird schon importiert; `spawn` kommt dazu.

- [ ] **Step 2: Clean up leftovers before anything else opens**

Direkt nach der Zeile `const dir = process.env.DIR || installDir` — vor der
`better_sqlite3.node`-Prüfung, damit eine halb geladene Datei nicht als
fehlend gemeldet wird:

```ts
// An interrupted update can leave rollback copies and half-finished downloads
// behind. That this process is running at all proves the files on disk start,
// so the copies have done their job.
if (isPackaged) {
  try {
    cleanupLeftovers(installDir)
  } catch (err) {
    console.error('[tandem] Aufräumen nach Update fehlgeschlagen:', err)
  }
}
```

- [ ] **Step 3: Declare state and controls — before `buildServer`**

Der Reihenfolge wegen zweigeteilt: die Routen müssen das Objekt schon haben,
die Aktionen brauchen `app`, `db` und `bonjour`, die es noch nicht gibt. Also
erst ein Objekt mit leeren Aktionen, direkt **vor** dem
`const app = buildServer(...)`-Aufruf:

```ts
// Only the shipped exe updates itself: it is the one build that owns the files
// it runs from. A dev `npm start`, the e2e run and the unit tests see phase
// 'disabled' and four routes that answer 501 — the same line notify, the
// shutdown button and the path dialogs already draw.
const updateState = new UpdateState(APP_VERSION, isPackaged ? 'idle' : 'disabled')

// The actions are filled in below, once app/db/bonjour exist for the install
// step to close. The object identity is what the routes hold on to.
const updateControls: UpdateControls | undefined = isPackaged
  ? { state: updateState, check: () => {}, download: () => {}, install: () => {} }
  : undefined
```

- [ ] **Step 4: Hand it to `buildServer`**

Der vorhandene Aufruf bekommt sein achtes Argument:

```ts
const app = buildServer(db, cfgRef, contractTemplate, (c) => saveConfig(dir, c), notify, pickPath,
  () => { void shutdown('Beenden über das Manifest') }, updateControls)
```

- [ ] **Step 5: Define the actions — after `app`, `db` and `bonjour` exist**

Unterhalb von `let bonjour: Bonjour | undefined`, neben der vorhandenen
`shutdown`-Funktion:

```ts
let updateBusy = false

async function runCheck(isStartup: boolean) {
  if (updateBusy) return
  updateState.beginCheck()
  updateState.foundRelease(await fetchLatestRelease(), isStartup)
}

async function runDownload() {
  const release = updateState.release
  if (!release || updateBusy) return
  updateBusy = true
  updateState.patch({ phase: 'downloading', downloadedBytes: 0, totalBytes: 0, error: null })
  try {
    await downloadRelease(release, {
      dir: installDir,
      fetchStream: defaultFetchStream,
      onProgress: (downloadedBytes, totalBytes) =>
        updateState.patch({ phase: 'downloading', downloadedBytes, totalBytes }),
    })
    updateState.patch({ phase: 'ready', error: null })
  } catch (err) {
    removePartials(installDir)
    updateState.fail('download-failed', err instanceof Error ? err.message : String(err))
  } finally {
    updateBusy = false
  }
}

/** True once a Tandem answers on our port again — the new process is up. */
function waitForHealth(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = async () => {
      if (await tandemAlreadyRunning()) return resolve(true)
      if (Date.now() >= deadline) return resolve(false)
      setTimeout(tick, 1000).unref?.()
    }
    // A moment's grace: the child has to get as far as listen() first.
    setTimeout(tick, 1000).unref?.()
  })
}

async function runInstall() {
  if (updateState.get().phase !== 'ready' || updateBusy) return
  updateBusy = true
  updateState.patch({ phase: 'installing', error: null })
  try {
    await installUpdate({
      dir: installDir,
      closeServer: async () => {
        if (bonjour) {
          await new Promise<void>((resolve) => {
            bonjour!.unpublishAll(() => bonjour!.destroy(() => resolve()))
          })
        }
        await app.close()
        db.close()
      },
      spawnDetached: (exePath) => {
        const child = spawn(exePath, [], {
          detached: true, stdio: 'ignore', cwd: path.dirname(exePath), windowsHide: true,
        })
        child.unref()
        return { kill: () => child.kill() }
      },
      waitForHealth,
      exit: (code) => process.exit(code),
    })
  } catch (err) {
    updateBusy = false
    updateState.fail('install-failed', err instanceof Error ? err.message : String(err))
  }
}

if (updateControls) {
  updateControls.check = () => { void runCheck(false) }
  updateControls.download = () => { void runDownload() }
  updateControls.install = () => { void runInstall() }
}
```

`tandemAlreadyRunning` ist eine Funktionsdeklaration und wird gehoisted —
`waitForHealth` darf sie von hier aus aufrufen, obwohl sie weiter unten steht.

- [ ] **Step 6: Broadcast every change and pick up a failed attempt**

Next to the `buildServer` call, where the `SseHub` is reachable — the hub lives
inside `buildServer`, so expose a broadcast hook instead. In
`src/server/index.ts`, right after `registerUpdateRoutes(app, db, update)`:

```ts
  // The manifest's update screen redraws from this instead of polling a
  // 114 MB download's progress over HTTP.
  update?.state.onChange((status) => sse.broadcast('update', status))
```

and in `main.ts`, after the controls exist:

```ts
const failure = isPackaged ? takeFailureMarker(installDir) : null
if (failure) updateState.fail('install-failed', failure)
```

- [ ] **Step 7: Check after listen, then hourly**

Inside the existing `app.listen({...}).then(() => { … })`, after
`if (isPackaged) openBrowser(...)`:

```ts
  if (isPackaged) {
    // Late enough that the tablets are served first, and unref'd so neither
    // timer keeps the process alive. A site without internet notices nothing.
    setTimeout(() => { void runCheck(true) }, 5000).unref?.()
    setInterval(() => { void runCheck(false) }, 60 * 60 * 1000).unref?.()
  }
```

- [ ] **Step 8: Verify the dev server still reports itself disabled**

Run: `npm test && npx tsc -b`
Expected: all green, including `tests/update-route.test.ts`.

- [ ] **Step 9: Boot the dev server and read the status by hand**

Run: `npm start` in one terminal, then in another:
`curl -s http://localhost/api/update/status`
Expected: `{"phase":"disabled", … ,"allowed":false,"promptPending":false,"openToday":0}`
Then stop the dev server with Strg+C.

- [ ] **Step 10: Commit**

```bash
git add src/server/main.ts src/server/index.ts
git commit -m "feat(update): Abfrage, Download und Neustart im gepackten Exe verdrahten"
```

---

## Task 8: Die Release-Notes rendern

**Files:**
- Create: `web/manifest/src/markdown.tsx`
- Create: `web/manifest/src/markdown.test.tsx`

**Interfaces:**
- Consumes: nichts.
- Produces: `export function Markdown({ text }: { text: string }): ReactNode`

### Warum

Die Notes kommen von GitHub und benutzen genau diese Teilmenge (siehe den
`body` von `v1.1.0`): `##`/`###`, `**fett**`, `` `code` ``, `-`-Listen,
Absätze. Alles andere bleibt Text. Kein `dangerouslySetInnerHTML`, keine neue
Abhängigkeit.

- [ ] **Step 1: Write the failing test**

`web/manifest/src/markdown.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Markdown } from './markdown'

describe('Markdown', () => {
  it('renders ## and ### as headings', () => {
    render(<Markdown text={'## Kassieren\n\n### Details'} />)
    expect(screen.getByRole('heading', { level: 3, name: 'Kassieren' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 4, name: 'Details' })).toBeInTheDocument()
  })

  it('renders - lines as a list', () => {
    render(<Markdown text={'- eins\n- zwei'} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders **bold** inside a paragraph', () => {
    const { container } = render(<Markdown text="Ein **wichtiger** Satz." />)
    expect(container.querySelector('strong')).toHaveTextContent('wichtig')
  })

  it('renders `code` as code', () => {
    const { container } = render(<Markdown text="Die Datei `tandem.exe` ist groß." />)
    expect(container.querySelector('code')).toHaveTextContent('tandem.exe')
  })

  it('keeps blank-line-separated blocks apart', () => {
    const { container } = render(<Markdown text={'Erster Absatz.\n\nZweiter Absatz.'} />)
    expect(container.querySelectorAll('p')).toHaveLength(2)
  })

  // The text comes from the internet. It is rendered, never interpreted.
  it('never builds HTML out of the text', () => {
    const { container } = render(<Markdown text="<img src=x onerror=alert(1)>" />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('renders nothing for an empty release body', () => {
    const { container } = render(<Markdown text="" />)
    expect(container.textContent).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web/manifest test -- markdown`
Expected: FAIL — `Failed to resolve import "./markdown"`

- [ ] **Step 3: Write `web/manifest/src/markdown.tsx`**

```tsx
import type { ReactNode } from 'react'

/**
 * The slice of Markdown the GitHub release notes actually use — headings, bold,
 * inline code, dash lists, paragraphs.
 *
 * Written out rather than pulled in: the text arrives from the internet, and
 * everything here produces React elements, never HTML. There is no path from a
 * release body to an executed tag.
 */

// Split on the two inline forms at once so the parts alternate predictably.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

export function Markdown({ text }: { text: string }): ReactNode {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== '')

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')

        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.slice(2), `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }

        // A heading is its own block; anything after it in the same block is an
        // ordinary paragraph, which is how GitHub bodies are written anyway.
        const heading = /^(#{2,3})\s+(.*)$/.exec(lines[0])
        if (heading) {
          const rest = lines.slice(1).join(' ')
          // ## becomes h3: the screen's own title is the h2.
          const Tag = heading[1].length === 2 ? 'h3' : 'h4'
          return (
            <div key={bi}>
              <Tag>{inline(heading[2], `${bi}-h`)}</Tag>
              {rest.trim() !== '' && <p>{inline(rest, `${bi}-r`)}</p>}
            </div>
          )
        }

        return <p key={bi}>{inline(lines.join(' '), `${bi}`)}</p>
      })}
    </>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web/manifest test -- markdown`
Expected: PASS â die tabellengetriebene Schrankenpruefung plus die Tests fuer Status-Nutzlast, openToday und die Dialog-Abfolge.

- [ ] **Step 5: Commit**

```bash
git add web/manifest/src/markdown.tsx web/manifest/src/markdown.test.tsx
git commit -m "feat(update): Release-Notes als React-Elemente rendern"
```

---

## Task 9: Der Zugang zum Server im Manifest

**Files:**
- Modify: `web/manifest/src/api.ts`
- Modify: `web/manifest/src/useEvents.ts`
- Modify: `web/manifest/src/setupTests.ts`

**Interfaces:**
- Consumes: `UpdateStatusResponse` (Task 4).
- Produces:
  ```ts
  // api.ts
  export type UpdatePhase = /* die zwölf Werte aus Task 3 */
  export interface UpdateStatus { … ; allowed: boolean; promptPending: boolean; openToday: number }
  export function getUpdateStatus(): Promise<UpdateStatus>
  export function checkForUpdate(): Promise<void>
  export function startUpdateDownload(): Promise<void>
  export function installUpdate(): Promise<void>
  export function markUpdatePromptSeen(): Promise<void>
  export function serverAlive(): Promise<boolean>
  export function reloadPage(): void
  // useEvents.ts
  export function useUpdateEvents(enabled: boolean, onStatus: (s: UpdateStatus) => void): void
  // setupTests.ts
  export function fireUpdateEvent(status: unknown): void
  ```

### Warum

`useEvents` hört heute nur auf `changed` und bekommt keine Daten. Der
Update-Zustand braucht beides: ein anderes Event und dessen Nutzlast. Der Hook
wird nur geöffnet, wenn `allowed` gilt — sonst baut jedes Tablet eine zweite
`EventSource` auf, für etwas, das es nie sehen darf.

- [ ] **Step 1: Extend the EventSource stub so a test can carry data**

In `web/manifest/src/setupTests.ts` — `FakeEventSource` bekommt `data`:

```ts
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  static dispatch(type: string, data?: unknown) {
    for (const instance of FakeEventSource.instances) {
      for (const listener of instance.listeners.get(type) ?? []) {
        listener({ data: JSON.stringify(data ?? null) } as MessageEvent)
      }
    }
  }
```

Die Typen der `listeners`-Map ziehen entsprechend nach
(`Map<string, Set<(event: MessageEvent) => void>>`), und daneben:

```ts
/** Simulates the server broadcasting an `update` event with its status payload. */
export function fireUpdateEvent(status: unknown) {
  FakeEventSource.dispatch('update', status)
}
```

`fireChangedEvent` bleibt, wie es ist — `dispatch('changed')` ruft die
Listener jetzt mit einem Event-Objekt auf, das `List.tsx` ignoriert.

- [ ] **Step 2: Add the hook to `useEvents.ts`**

```ts
import type { UpdateStatus } from './api'

/**
 * The update status, pushed. Opened ONLY when the server said this client may
 * act on updates: the manifest runs on every tablet in the club WLAN, and none
 * of them should hold a second connection open for a screen they never see.
 */
export function useUpdateEvents(
  enabled: boolean,
  onStatus: (status: UpdateStatus) => void,
): void {
  const onStatusRef = useRef(onStatus)
  onStatusRef.current = onStatus

  useEffect(() => {
    if (!enabled) return
    const source = new EventSource(`${getApiBase()}/api/events`)
    const handle = (event: MessageEvent) => {
      try {
        onStatusRef.current(JSON.parse(event.data) as UpdateStatus)
      } catch {
        // A frame we cannot read changes nothing on screen; the next one will.
      }
    }
    source.addEventListener('update', handle)
    return () => {
      source.removeEventListener('update', handle)
      source.close()
    }
  }, [enabled])
}
```

- [ ] **Step 3: Add the calls to `api.ts`**

Am Ende der Datei, im Stil der vorhandenen Helfer (alle benutzen `apiUrl`):

```ts
export type UpdatePhase =
  | 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'check-failed'
  | 'available' | 'downloading' | 'verifying' | 'ready'
  | 'download-failed' | 'installing' | 'install-failed'

export interface UpdateStatus {
  phase: UpdatePhase
  currentVersion: string
  latestVersion: string | null
  notes: string | null
  downloadedBytes: number
  totalBytes: number
  error: string | null
  checkedAt: string | null
  /** Whether THIS client may act — true only on the machine the server runs on. */
  allowed: boolean
  promptPending: boolean
  openToday: number
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const res = await fetch(apiUrl('/api/update/status'))
  if (!res.ok) throw new Error('Update-Status nicht abrufbar')
  return res.json() as Promise<UpdateStatus>
}

async function updateAction(rootPath: string): Promise<void> {
  const res = await fetch(apiUrl(rootPath), { method: 'POST' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? 'Aktion fehlgeschlagen')
  }
}

export const checkForUpdate = () => updateAction('/api/update/check')
export const startUpdateDownload = () => updateAction('/api/update/download')
export const installUpdate = () => updateAction('/api/update/install')
export const markUpdatePromptSeen = () => updateAction('/api/update/prompt-seen')

/** Used while waiting for the restarted server to come back. */
export async function serverAlive(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl('/api/health'), { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

// A seam, not a wrapper for its own sake: jsdom makes window.location
// non-configurable, so a test cannot spy on it. Going through here lets the
// update screen's restart path be tested like any other api call.
export function reloadPage(): void {
  window.location.reload()
}
```

- [ ] **Step 4: Verify types and the existing suite**

Run: `npm --prefix web/manifest exec tsc -b && npm --prefix web/manifest test`
Expected: no type errors; every existing test still passes (the stub change
touches `List.test.tsx` and `App.test.tsx` indirectly).

- [ ] **Step 5: Commit**

```bash
git add web/manifest/src/api.ts web/manifest/src/useEvents.ts web/manifest/src/setupTests.ts
git commit -m "feat(update): Update-Status und -Aktionen im Manifest erreichbar"
```

---

## Task 10: Der Update-Schirm

**Files:**
- Create: `web/manifest/src/Update.tsx`
- Create: `web/manifest/src/Update.test.tsx`
- Modify: `web/manifest/src/index.css`

**Interfaces:**
- Consumes: `UpdateStatus`, `startUpdateDownload`, `installUpdate`,
  `serverAlive` (Task 9), `Markdown` (Task 8).
- Produces:
  ```ts
  export interface UpdateProps { status: UpdateStatus; onRefresh: () => void }
  export default function Update(props: UpdateProps): JSX.Element
  ```

### Warum

Ein Schirm, eine Aktion — welche, entscheidet allein `phase`. Vor dem Neustart
fragt ein `confirm`, das die Zahl der offenen Tandems nennt: das Update beendet
den Sprungtag für jedes Tablet, und der Operator soll die Zahl sehen, bevor er
das tut.

- [ ] **Step 1: Write the failing test**

`web/manifest/src/Update.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Update from './Update'
import * as api from './api'
import type { UpdateStatus } from './api'

vi.mock('./api', () => ({
  startUpdateDownload: vi.fn(),
  installUpdate: vi.fn(),
  serverAlive: vi.fn(),
  reloadPage: vi.fn(),
}))

const status = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  phase: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0',
  notes: '## Kassieren\n\nMehrere Tandems auf einmal.',
  downloadedBytes: 0, totalBytes: 0, error: null, checkedAt: '2026-09-21T08:00:00Z',
  allowed: true, promptPending: false, openToday: 0,
  ...over,
})

describe('Update', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.startUpdateDownload).mockResolvedValue()
    vi.mocked(api.installUpdate).mockResolvedValue()
  })

  it('names both versions and shows the release notes', () => {
    render(<Update status={status()} onRefresh={vi.fn()} />)
    expect(screen.getByText('1.1.0')).toBeInTheDocument()
    expect(screen.getByText('1.2.0')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Kassieren' })).toBeInTheDocument()
  })

  it('offers the download and starts it', async () => {
    render(<Update status={status()} onRefresh={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Herunterladen' }))
    expect(api.startUpdateDownload).toHaveBeenCalledTimes(1)
  })

  it('shows progress in MB while downloading', () => {
    render(
      <Update
        status={status({ phase: 'downloading', downloadedBytes: 57_000_000, totalBytes: 116_000_000 })}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '49')
    expect(screen.getByText(/57 MB von 116 MB/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Herunterladen' })).toBeNull()
  })

  it('asks before restarting and names the open tandems', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Update status={status({ phase: 'ready', openToday: 3 })} onRefresh={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Jetzt installieren und neu starten' }),
    )
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('3'))
    expect(api.installUpdate).toHaveBeenCalledTimes(1)
    confirmSpy.mockRestore()
  })

  it('installs nothing when the question is answered with no', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<Update status={status({ phase: 'ready' })} onRefresh={vi.fn()} />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Jetzt installieren und neu starten' }),
    )
    expect(api.installUpdate).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // jsdom makes window.location non-configurable, so the reload goes through
  // api.reloadPage — a seam that can be mocked like every other call here.
  it('waits for the restarted server and then reloads', async () => {
    vi.mocked(api.serverAlive).mockResolvedValueOnce(false).mockResolvedValue(true)
    render(<Update status={status({ phase: 'installing' })} onRefresh={vi.fn()} />)
    expect(screen.getByText(/startet neu/)).toBeInTheDocument()
    await waitFor(() => expect(api.reloadPage).toHaveBeenCalled(), { timeout: 5000 })
  })

  it('keeps waiting while the new server is still down', async () => {
    vi.mocked(api.serverAlive).mockResolvedValue(false)
    render(<Update status={status({ phase: 'installing' })} onRefresh={vi.fn()} />)
    await waitFor(() => expect(api.serverAlive).toHaveBeenCalled())
    expect(api.reloadPage).not.toHaveBeenCalled()
  })

  it('shows a failed download with a way to try again', async () => {
    render(
      <Update
        status={status({ phase: 'download-failed', error: 'Prüfsumme stimmt nicht.' })}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText('Prüfsumme stimmt nicht.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }))
    expect(api.startUpdateDownload).toHaveBeenCalledTimes(1)
  })

  it('says so when there is nothing to install', () => {
    render(<Update status={status({ phase: 'up-to-date', latestVersion: '1.1.0' })} onRefresh={vi.fn()} />)
    expect(screen.getByText(/aktuellste Version/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web/manifest test -- Update`
Expected: FAIL — `Failed to resolve import "./Update"`

- [ ] **Step 3: Write `web/manifest/src/Update.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { installUpdate, reloadPage, serverAlive, startUpdateDownload } from './api'
import type { UpdateStatus } from './api'
import { Markdown } from './markdown'

export interface UpdateProps {
  status: UpdateStatus
  /** Pull the status again — used after an action whose result is not pushed. */
  onRefresh: () => void
}

const mb = (bytes: number) => Math.round(bytes / 1_000_000)

export default function Update({ status, onRefresh }: UpdateProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The server is being replaced under us. Nothing on this screen is worth
  // showing until the new one answers, and then only a fresh page is honest.
  useEffect(() => {
    if (status.phase !== 'installing') return
    let stopped = false
    const poll = async () => {
      if (stopped) return
      if (await serverAlive()) {
        reloadPage()
        return
      }
      window.setTimeout(poll, 1000)
    }
    const timer = window.setTimeout(poll, 1000)
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [status.phase])

  async function run(action: () => Promise<void>) {
    setError(null)
    setBusy(true)
    try {
      await action()
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen')
    } finally {
      setBusy(false)
    }
  }

  function handleInstall() {
    const open = status.openToday
    const openLine =
      open === 0
        ? ''
        : open === 1
          ? '\n\nEin Tandem von heute ist noch offen.'
          : `\n\n${open} Tandems von heute sind noch offen.`
    const confirmed = window.confirm(
      `Jetzt auf Version ${status.latestVersion} aktualisieren?\n\n` +
        'Das Programm startet dabei neu. Gäste-Anmeldung und Manifest sind auf ' +
        'allen Geräten für einen Moment nicht erreichbar.' +
        openLine,
    )
    if (!confirmed) return
    void run(installUpdate)
  }

  const percent =
    status.totalBytes > 0 ? Math.round((status.downloadedBytes / status.totalBytes) * 100) : 0

  return (
    <div className="update-screen">
      <h2>Update</h2>

      <dl className="update-versions">
        <dt>Installierte Version</dt>
        <dd>{status.currentVersion}</dd>
        <dt>Neueste Version</dt>
        <dd>{status.latestVersion ?? 'unbekannt'}</dd>
      </dl>

      {(error || status.error) && <p className="error">{error ?? status.error}</p>}

      {status.phase === 'available' && (
        <button type="button" className="btn primary" disabled={busy}
          onClick={() => void run(startUpdateDownload)}>
          Herunterladen
        </button>
      )}

      {(status.phase === 'downloading' || status.phase === 'verifying') && (
        <div className="update-progress">
          <progress role="progressbar" max={100} value={percent}
            aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} />
          <p>
            {mb(status.downloadedBytes)} MB von {mb(status.totalBytes)} MB ({percent} %)
          </p>
        </div>
      )}

      {status.phase === 'ready' && (
        <button type="button" className="btn primary" disabled={busy} onClick={handleInstall}>
          Jetzt installieren und neu starten
        </button>
      )}

      {status.phase === 'installing' && <p className="update-restarting">Tandem startet neu…</p>}

      {(status.phase === 'download-failed' || status.phase === 'install-failed') && (
        <button type="button" className="btn secondary" disabled={busy}
          onClick={() => void run(startUpdateDownload)}>
          Erneut versuchen
        </button>
      )}

      {status.phase === 'up-to-date' && <p>Dies ist bereits die aktuellste Version.</p>}

      {status.notes && (
        <section className="update-notes">
          <h3>Was neu ist</h3>
          <Markdown text={status.notes} />
        </section>
      )}
    </div>
  )
}
```

**Note:** `Markdown` renders `##` as `h3`. The "Was neu ist" heading above is
also an `h3`, so the test that looks for `heading level 3, name 'Kassieren'`
still finds the right one by name. Do not renumber either.

- [ ] **Step 4: Add the styles to `index.css`**

Nur vorhandene Custom Properties, keine neuen Farbliterale — dieselbe Regel,
die `.sidebar-bottom` schon befolgt:

```css
.update-screen {
  padding: 24px 28px;
  max-width: 720px;
}

.update-versions {
  display: grid;
  grid-template-columns: max-content auto;
  gap: 4px 16px;
  margin: 0 0 20px;
}

.update-versions dt { font-weight: 600; }
.update-versions dd { margin: 0; }

.update-progress progress { width: 100%; height: 14px; }
.update-progress p { margin: 6px 0 0; }

.update-notes { margin-top: 28px; }
.update-notes h3 { margin-bottom: 4px; }
.update-notes ul { margin: 4px 0 12px 20px; }

/* The sidebar entry only exists while something is pending, so it may shout. */
.tab .update-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-left: 6px;
  border-radius: 50%;
  background: currentColor;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm --prefix web/manifest test -- Update`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add web/manifest/src/Update.tsx web/manifest/src/Update.test.tsx web/manifest/src/index.css
git commit -m "feat(update): Update-Schirm mit Fortschritt, Notes und Neustart"
```

---

## Task 11: Dialog und Sidebar-Eintrag

**Files:**
- Create: `web/manifest/src/UpdateDialog.tsx`
- Create: `web/manifest/src/UpdateDialog.test.tsx`
- Modify: `web/manifest/src/App.tsx`
- Modify: `web/manifest/src/App.test.tsx`

**Interfaces:**
- Consumes: alles aus Task 9 und 10.
- Produces:
  ```ts
  export interface UpdateDialogProps {
    currentVersion: string
    latestVersion: string
    onAccept: () => void
    onLater: () => void
  }
  export default function UpdateDialog(props: UpdateDialogProps): JSX.Element
  ```

### Warum

Das Modal kommt vom Server (`promptPending`), nicht vom Browser: es soll genau
einmal pro Serverstart erscheinen, auf dem Host-PC, und nie über einem halb
ausgefüllten Manifest mitten am Tag. Der Sidebar-Eintrag erscheint nur, solange
wirklich etwas offen ist, und nur dort, wo er benutzbar ist.

- [ ] **Step 1: Write the failing dialog test**

`web/manifest/src/UpdateDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import UpdateDialog from './UpdateDialog'

const props = () => ({
  currentVersion: '1.1.0', latestVersion: '1.2.0',
  onAccept: vi.fn(), onLater: vi.fn(),
})

describe('UpdateDialog', () => {
  it('opens as a modal and names both versions', () => {
    render(<UpdateDialog {...props()} />)
    expect(screen.getByRole('dialog')).toHaveProperty('open', true)
    expect(screen.getByText(/1\.1\.0/)).toBeInTheDocument()
    expect(screen.getByText(/1\.2\.0/)).toBeInTheDocument()
  })

  it('says that the program restarts', () => {
    render(<UpdateDialog {...props()} />)
    expect(screen.getByText(/startet danach neu/)).toBeInTheDocument()
  })

  it('reports the accepted update', async () => {
    const p = props()
    render(<UpdateDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Jetzt aktualisieren' }))
    expect(p.onAccept).toHaveBeenCalledTimes(1)
  })

  it('reports a postponed update', async () => {
    const p = props()
    render(<UpdateDialog {...p} />)
    await userEvent.click(screen.getByRole('button', { name: 'Später' }))
    expect(p.onLater).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix web/manifest test -- UpdateDialog`
Expected: FAIL — `Failed to resolve import "./UpdateDialog"`

- [ ] **Step 3: Write `web/manifest/src/UpdateDialog.tsx`**

Derselbe Bau wie `CollectDialog.tsx`: `showModal()` beim Mounten, kein
`open`-Prop, der Elternteil unmountet zum Schließen.

```tsx
import { useEffect, useRef } from 'react'

export interface UpdateDialogProps {
  currentVersion: string
  latestVersion: string
  onAccept: () => void
  onLater: () => void
}

export default function UpdateDialog({
  currentVersion, latestVersion, onAccept, onLater,
}: UpdateDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)

  // Mount-only, like CollectDialog: App unmounts this to close it, and the
  // jsdom stub in setupTests.ts dispatches no `close` event to react to.
  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="update-dialog"
      onCancel={onLater}
      aria-labelledby="update-dialog-title"
    >
      <h2 id="update-dialog-title">Update verfügbar</h2>
      <p>
        Version {currentVersion} → {latestVersion}
      </p>
      <p>
        Jetzt herunterladen? Das Programm startet danach neu; alle Tablets
        verlieren dabei kurz die Verbindung.
      </p>
      <div className="dialog-buttons">
        <button type="button" className="btn primary" onClick={onAccept}>
          Jetzt aktualisieren
        </button>
        <button type="button" className="btn secondary" onClick={onLater}>
          Später
        </button>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 4: Run the dialog test**

Run: `npm --prefix web/manifest test -- UpdateDialog`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing App test**

Ergänzt `web/manifest/src/App.test.tsx`. Der vorhandene `vi.mock('./api', …)`
in dieser Datei bekommt die fünf neuen Funktionen dazu:

```tsx
import { fireUpdateEvent } from './setupTests'

const updateStatus = (over = {}) => ({
  phase: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0',
  notes: null, downloadedBytes: 0, totalBytes: 0, error: null,
  checkedAt: null, allowed: true, promptPending: false, openToday: 0,
  ...over,
})

describe('App und das Update', () => {
  beforeEach(() => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus())
    vi.mocked(api.markUpdatePromptSeen).mockResolvedValue()
    vi.mocked(api.startUpdateDownload).mockResolvedValue()
  })

  it('shows the sidebar entry once an update is available', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: /Update/ })).toBeInTheDocument()
  })

  // The manifest runs on every tablet in the club WLAN; only the machine the
  // server runs on can do anything about an update.
  it('hides the entry from a device that may not act', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ allowed: false }))
    render(<App />)
    await screen.findByRole('button', { name: 'Manifest' })
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('shows no entry while everything is up to date', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(
      updateStatus({ phase: 'up-to-date', latestVersion: '1.1.0' }),
    )
    render(<App />)
    await screen.findByRole('button', { name: 'Manifest' })
    expect(screen.queryByRole('button', { name: /Update/ })).toBeNull()
  })

  it('opens the dialog exactly when the server says it is pending', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
    render(<App />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('starts the download and opens the screen on yes', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Jetzt aktualisieren' }))
    expect(api.markUpdatePromptSeen).toHaveBeenCalledTimes(1)
    expect(api.startUpdateDownload).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Update' })).toBeInTheDocument()
  })

  it('only marks the dialog seen on later', async () => {
    vi.mocked(api.getUpdateStatus).mockResolvedValue(updateStatus({ promptPending: true }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Später' }))
    expect(api.markUpdatePromptSeen).toHaveBeenCalledTimes(1)
    expect(api.startUpdateDownload).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Progress must not cost one request per percent.
  it('redraws from the pushed status', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /Update/ })
    fireUpdateEvent({ ...updateStatus({ phase: 'downloading', downloadedBytes: 5, totalBytes: 10 }) })
    await userEvent.click(screen.getByRole('button', { name: /Update/ }))
    expect(await screen.findByRole('progressbar')).toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm --prefix web/manifest test -- App`
Expected: FAIL — the sidebar has no Update entry.

- [ ] **Step 7: Wire it into `App.tsx`**

Der `View`-Typ bekommt `'update'`:

```tsx
type View = 'list' | 'detail' | 'stammdaten' | 'settings' | 'update'
```

Zustand und Laden, neben dem vorhandenen `shutdownAllowed()`-Effekt:

```tsx
  // The update status is fetched once and then pushed: a 114 MB download would
  // otherwise cost one request per percent, from every open manifest.
  const [update, setUpdate] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    getUpdateStatus()
      .then(setUpdate)
      .catch(() => {
        // An older server without the update routes. No entry, no dialog —
        // exactly what a server that cannot update itself should show.
      })
  }, [])

  useUpdateEvents(update?.allowed === true, (status) =>
    // The pushed frame carries the server's view of the state; `allowed`,
    // `promptPending` and `openToday` are per-client and stay as fetched.
    setUpdate((prev) => (prev ? { ...prev, ...status, allowed: prev.allowed } : prev)),
  )

  const refreshUpdate = () => { void getUpdateStatus().then(setUpdate).catch(() => {}) }

  // Only while something is actually pending — and only where it can be acted on.
  const PENDING: UpdatePhase[] = [
    'available', 'downloading', 'verifying', 'ready', 'download-failed', 'install-failed',
  ]
  const showUpdateTab = update?.allowed === true && PENDING.includes(update.phase)

  const [promptDismissed, setPromptDismissed] = useState(false)
  const showPrompt =
    update?.allowed === true && update.promptPending && !promptDismissed &&
    update.latestVersion !== null

  function acceptUpdate() {
    setPromptDismissed(true)
    void markUpdatePromptSeen()
    void startUpdateDownload().then(refreshUpdate).catch(() => {})
    setView('update')
  }

  function postponeUpdate() {
    setPromptDismissed(true)
    void markUpdatePromptSeen()
  }
```

Der Sidebar-Eintrag, direkt nach dem `Einstellungen`-Tab:

```tsx
          {showUpdateTab && (
            <button
              type="button"
              className={view === 'update' ? 'tab active' : 'tab'}
              onClick={() => setView('update')}
            >
              Update
              <span className="update-dot" aria-hidden="true" />
            </button>
          )}
```

Der Schirm, neben den anderen Views:

```tsx
        {view === 'update' && update && (
          <Update status={update} onRefresh={refreshUpdate} />
        )}
```

Und der Dialog, als Geschwister von `Urkunde` ganz oben im Baum:

```tsx
      {showPrompt && update && (
        <UpdateDialog
          currentVersion={update.currentVersion}
          latestVersion={update.latestVersion!}
          onAccept={acceptUpdate}
          onLater={postponeUpdate}
        />
      )}
```

Mit den Importen:

```tsx
import Update from './Update'
import UpdateDialog from './UpdateDialog'
import { getUpdateStatus, markUpdatePromptSeen, startUpdateDownload } from './api'
import type { UpdatePhase, UpdateStatus } from './api'
import { useUpdateEvents } from './useEvents'
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm --prefix web/manifest test`
Expected: all green, including the seven new App tests.

- [ ] **Step 9: Type check both halves**

Run: `npm --prefix web/manifest exec tsc -b && npx tsc -b`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add web/manifest/src/UpdateDialog.tsx web/manifest/src/UpdateDialog.test.tsx web/manifest/src/App.tsx web/manifest/src/App.test.tsx
git commit -m "feat(update): Dialog beim Start und Sidebar-Eintrag nur am Host-PC"
```

---

## Task 12: Der echte Tausch, von Hand — und die Dokumentation

**Files:**
- Modify: `build.md`

**Interfaces:**
- Consumes: alles.
- Produces: nichts im Code.

### Warum

Alles bis hier ist gegen Attrappen geprüft. Der eine Schritt, den kein Unit-Test
abdeckt, ist der echte: ein laufendes 114-MB-Exe, das sich selbst ersetzt und
neu startet. Dieser Task führt ihn einmal aus, bevor irgendjemand sich darauf
verlässt.

- [ ] **Step 1: Build a full exe**

Run: `npm run build:all`
Expected: `dist/tandem.exe` und `dist/better_sqlite3.node` liegen neu da.

- [ ] **Step 2: Stage an installation and a fake release**

```bash
mkdir -p /c/Temp/tandem-updatetest
cp dist/tandem.exe dist/better_sqlite3.node /c/Temp/tandem-updatetest/
```

Bump `package.json` to `1.1.1`, run `npm run build:server && npm run build:exe`
again, and copy that second pair somewhere else — it becomes the "release".
Serve it, together with a release JSON that carries the real sha256 of both
files, from a local static server. Point the exe at it through the environment
— no source edit, nothing to revert:

```
set TANDEM_RELEASE_URL=http://127.0.0.1:8099/latest
C:\Temp\tandem-updatetest\tandem.exe
```

The sha256 of each file:

```bash
sha256sum /pfad/zur/tandem.exe /pfad/zum/better_sqlite3.node
```

- [ ] **Step 3: Run the real thing**

Start `C:\Temp\tandem-updatetest\tandem.exe`, wait for the manifest tab, accept
the dialog, watch the progress bar, press install.

Expected, in order:
1. The page says „Tandem startet neu…“.
2. The tab reloads by itself and the manifest is back.
3. `C:\Temp\tandem-updatetest` contains exactly `tandem.exe`,
   `better_sqlite3.node`, `config.json`, `tandem.db` (plus `-wal`/`-shm`) —
   **no** `.old` and **no** `.new` files.
4. The update screen now says „Dies ist bereits die aktuellste Version.“

- [ ] **Step 4: Prove the rollback**

Repeat with a deliberately broken release: take the 1.1.1 exe and truncate it
(`head -c 1000000 tandem.exe > broken.exe`), publish that as the release asset,
and fix the JSON's sha256 to match the truncated file so the download passes and
the **start** fails.

Expected:
1. The old process comes back by itself — the manifest is reachable again.
2. The folder holds the original `tandem.exe` (same size as before).
3. The update screen shows „Die neue Version ist nicht gestartet. Die vorherige
   Version wurde wiederhergestellt und läuft weiter.“

- [ ] **Step 5: Document it in `build.md`**

Add a section after „Node version / ABI matching“:

````markdown
## Selbstupdate

`tandem.exe` fragt 5 s nach dem Start und danach stündlich bei
`api.github.com/repos/MarkusSeiberl/Tandem-Registration/releases/latest` nach
einer neueren Version und bietet sie im Manifest an. Der Tausch läuft im
laufenden Prozess ab — auf Windows darf ein laufendes Exe umbenannt und an
seinen alten Pfad sofort neu geschrieben werden, und für das geladene
`better_sqlite3.node` gilt dasselbe. Deshalb gibt es kein Hilfsskript.

**Ein Release muss beide Dateien tragen.** `better_sqlite3.node` ist gegen die
Node-ABI des Build-Rechners gebaut, und `build-exe.mjs` leitet das pkg-Target
aus derselben Node-Version ab; ein Update, das nur das Exe tauscht, stirbt nach
einem Node-Major-Wechsel beim Start. Ein Release, dem eine der beiden fehlt,
wird vom Updater ignoriert.

**Die Version muss zum Tag passen.** `build:exe` ruft zuerst
`scripts/check-version-tag.mjs` auf und bricht ab, wenn `package.json` etwas
anderes sagt als der Git-Tag auf HEAD. `scripts/build-server.mjs` stempelt die
Version aus `package.json` als `__APP_VERSION__` in das Bundle.

**Checkliste für ein Release**

1. Version in `package.json` anheben.
2. Commit, dann `git tag vX.Y.Z`.
3. `npm run build:all`.
4. `gh release create vX.Y.Z dist/tandem.exe dist/better_sqlite3.node --notes-file …`

Die Release-Notes werden im Manifest angezeigt. Unterstützt sind `##`/`###`,
`**fett**`, `` `code` `` und `-`-Listen — alles andere erscheint als Text.

**Gegen ein echtes Release testen, ohne eines zu veröffentlichen:**
`TANDEM_RELEASE_URL` auf eine lokal ausgelieferte Kopie der GitHub-Antwort
setzen. Ohne die Variable fragt das Programm immer GitHub.

**Was das Programm beim Start aufräumt:** `tandem.old.exe`,
`better_sqlite3.old.node` (Rückroll-Kopien eines geglückten Updates),
`*.new` (abgebrochene Downloads) und `update-failed.json` (der Grund eines
gescheiterten Versuchs, wird einmal angezeigt).
````

- [ ] **Step 6: Make sure nothing from the staging run is left**

Run: `git status --porcelain src/ scripts/`
Expected: empty — the staging test ran entirely through
`TANDEM_RELEASE_URL` and a temp folder, so no source file was touched. Also
unset the variable in that shell (`set TANDEM_RELEASE_URL=`) before doing
anything else with a packaged exe.

- [ ] **Step 7: Full suite, both halves, one last time**

Run: `npm test && npx tsc -b && npm --prefix web/manifest test && npm --prefix web/manifest exec tsc -b`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add build.md
git commit -m "docs(update): Selbstupdate und Release-Checkliste in build.md"
```

---

## Offene Risiken

Diese bleiben nach dem Plan bestehen und sind bewusst nicht gelöst:

- **Das Exe ist nicht signiert.** Defender kann ein frisch geschriebenes
  114-MB-Binary erst scannen, bevor es startet. Die 90 s in `waitForHealth`
  sind darauf ausgelegt; ein sehr langsamer Rechner kann sie trotzdem reißen und
  einen unnötigen Rückroll auslösen. Falls das in der Praxis passiert, ist die
  Zahl der erste Hebel, eine Code-Signatur der zweite.
- **Kein Resume.** Ein WLAN-Abbruch bei 90 % kostet den ganzen Download.
- **Die stündliche Abfrage braucht Internet.** Ohne passiert nichts, sichtbar
  wird nichts.
