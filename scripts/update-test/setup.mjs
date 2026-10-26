#!/usr/bin/env node
// Builds a complete, throwaway setup for testing the self-update by hand
// (runbook: auto-update-handtest.md). Everything lands in one test folder,
// default C:\Temp\tandem-update-test:
//
//   release\            the real build of this checkout (package.json version)
//   release-broken\     the same, tandem.exe truncated -> cannot start
//   installed-ok\       a build stamped one version lower, one per scenario,
//   installed-checksum\   so each run starts from an untouched "old" install
//   installed-broken\
//   installed-offline\
//   start-*.cmd         one double-click per scenario, plus the fake server
//
// dist\ is the build folder for both builds. The release is built last, so
// dist\ ends up holding it by construction, never a copy of anything. Usage:
//   node scripts/update-test/setup.mjs [--root <dir>]

import { execFileSync, execSync } from 'child_process'
import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, truncateSync,
  writeFileSync,
} from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { waitUntilWritable } from '../wait-writable.mjs'

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dist = path.join(repo, 'dist')
const FILES = ['tandem.exe', 'better_sqlite3.node']
const MARKER = '.tandem-update-test'
const FAKE_PORT = 8099

const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root = path.resolve(rootArg >= 0 ? args[rootArg + 1] : 'C:\\Temp\\tandem-update-test')

const pkg = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'))
const releaseVersion = pkg.version

/** One version below `v`, so the release is offered as an update. */
function lowerVersion(v) {
  const [major, minor, patch] = v.split('.').map(Number)
  if (patch > 0) return `${major}.${minor}.${patch - 1}`
  if (minor > 0) return `${major}.${minor - 1}.99`
  return `${major - 1}.99.99`
}
const installedVersion = lowerVersion(releaseVersion)

// Each scenario: its own installed copy, port and release URL. "offline"
// points at a port nothing listens on, which is what a drop zone without
// internet looks like to the updater.
const SCENARIOS = [
  { name: 'ok', port: 8091, url: `http://127.0.0.1:${FAKE_PORT}/ok/latest`,
    expect: 'Update läuft durch, danach läuft Version ' + releaseVersion },
  { name: 'checksum', port: 8092, url: `http://127.0.0.1:${FAKE_PORT}/checksum/latest`,
    expect: 'Download wird abgelehnt (Prüfsumme), Version bleibt ' + installedVersion },
  { name: 'broken', port: 8093, url: `http://127.0.0.1:${FAKE_PORT}/broken/latest`,
    expect: 'Installation scheitert, Rückroll auf ' + installedVersion },
  { name: 'offline', port: 8094, url: 'http://127.0.0.1:9/latest',
    expect: 'Prüfung scheitert ruhig, kein Update angeboten' },
]

function run(cmd, cmdArgs, env = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`)
  const options = { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } }
  // node runs directly; only npm needs a shell on Windows (it is npm.cmd), and
  // its fixed arguments are passed as one command line rather than an array.
  if (cmd === 'node') execFileSync(process.execPath, cmdArgs, options)
  else execSync(`${cmd} ${cmdArgs.join(' ')}`, options)
}

function copyBuild(from, to) {
  mkdirSync(to, { recursive: true })
  for (const f of FILES) copyFileSync(path.join(from, f), path.join(to, f))
}

// Only ever delete a folder this script made: the marker file proves it.
if (existsSync(root)) {
  if (!existsSync(path.join(root, MARKER))) {
    console.error(`${root} existiert, stammt aber nicht von diesem Skript. Abbruch.`)
    process.exit(1)
  }
  // Emptied, not removed: a console or Explorer window open on the folder
  // (start-fake-server.cmd runs from it) locks the folder itself, never what
  // is inside.
  try {
    for (const entry of readdirSync(root)) {
      rmSync(path.join(root, entry), { recursive: true, force: true })
    }
  } catch (err) {
    console.error(`${root} lässt sich nicht löschen – läuft noch eine tandem.exe daraus?\n${err}`)
    process.exit(1)
  }
}
mkdirSync(root, { recursive: true })
writeFileSync(path.join(root, MARKER), 'Angelegt von scripts/update-test/setup.mjs\n')

/** Fails loudly if the bundle the exe was just packed from carries another
 *  version: a "release" that is secretly the test build updates to itself. */
function expectBundleVersion(version) {
  const bundle = readFileSync(path.join(dist, 'server.cjs'), 'utf8')
  if (!bundle.includes(JSON.stringify(version))) {
    console.error(`dist\\server.cjs trägt nicht die Version ${version}. Abbruch.`)
    process.exit(1)
  }
}

// 1. The "installed" build: same code, stamped one version lower. The steps of
//    build:exe without its version/tag check, which would refuse the stamp.
//    Never reused from an earlier run: always built here.
//    The web frontends first: the exe packs whatever web\*\dist holds, and a
//    stale one would test yesterday's pages.
run('npm', ['run', 'build:web'])
const stamp = { TANDEM_BUILD_VERSION: installedVersion }
run('node', ['scripts/build-server.mjs'], stamp)
expectBundleVersion(installedVersion)
run('node', ['scripts/build-exe.mjs'])
run('node', ['scripts/patch-subsystem.mjs'])
run('node', ['scripts/patch-version-info.mjs'])
run('node', ['scripts/copy-native-binary.mjs'])
// Windows Defender holds a freshly written exe for a few seconds.
await waitUntilWritable(path.join(dist, 'tandem.exe'))
for (const sc of SCENARIOS) copyBuild(dist, path.join(root, `installed-${sc.name}`))

// 2. The release: a normal build of this checkout, last, so dist\ keeps it.
run('npm', ['run', 'build:all'])
expectBundleVersion(releaseVersion)
await waitUntilWritable(path.join(dist, 'tandem.exe'))
copyBuild(dist, path.join(root, 'release'))

// 3. The broken release: same files, exe cut short. Windows refuses to start
//    it, which is what forces the rollback.
copyBuild(path.join(root, 'release'), path.join(root, 'release-broken'))
truncateSync(path.join(root, 'release-broken', 'tandem.exe'), 1_000_000)

// 4. What the fake server and the start files need.
writeFileSync(
  path.join(root, 'setup.json'),
  JSON.stringify({ releaseVersion, installedVersion, fakePort: FAKE_PORT, scenarios: SCENARIOS }, null, 2),
)

const cmd = (lines) => lines.join('\r\n') + '\r\n'
writeFileSync(path.join(root, 'start-fake-server.cmd'), cmd([
  '@echo off',
  'title Tandem Fake-Release-Server',
  `node "${path.join(repo, 'scripts', 'update-test', 'fake-release-server.mjs')}" "%~dp0." ${FAKE_PORT}`,
  'pause',
]))
for (const sc of SCENARIOS) {
  // `set` inside the .cmd only affects this one window and the exe it starts.
  writeFileSync(path.join(root, `start-${sc.name}.cmd`), cmd([
    '@echo off',
    `rem Erwartet: ${sc.expect}`,
    `set TANDEM_RELEASE_URL=${sc.url}`,
    `set PORT=${sc.port}`,
    `start "" "%~dp0installed-${sc.name}\\tandem.exe"`,
  ]))
}

console.log(`
Fertig: ${root}
  Release ${releaseVersion}, installiert ${installedVersion}

  1. start-fake-server.cmd starten (Fenster offen lassen)
  2. Je Szenario start-<name>.cmd, Manifest öffnet sich im Browser:
${SCENARIOS.map((s) => `     ${s.name.padEnd(9)} http://localhost:${s.port}/manifest  – ${s.expect}`).join('\n')}

Ablauf und Prüfpunkte: auto-update-handtest.md`)
