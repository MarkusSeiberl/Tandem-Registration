#!/usr/bin/env node
// Drives every scenario of the update test setup (setup.mjs) through the real
// exes, over the same API the Update screen uses, and checks the outcome. A
// quick automated pass before (or instead of) the manual run in
// auto-update-handtest.md. Each exe still opens its browser tab on start.
//
// Usage: node scripts/update-test/verify.mjs [--root <dir>]
// Run it on a fresh setup: a scenario that already updated has nothing left
// to update to.

import { spawn } from 'child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const rootArg = args.indexOf('--root')
const root = path.resolve(rootArg >= 0 ? args[rootArg + 1] : 'C:\\Temp\\tandem-update-test')
const setup = JSON.parse(readFileSync(path.join(root, 'setup.json'), 'utf8'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function status(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/update/status`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

async function post(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method: 'POST' })
  if (!res.ok && res.status !== 202 && res.status !== 204) {
    throw new Error(`POST ${route}: HTTP ${res.status}`)
  }
}

/** Polls until `pred(status)` holds; returns that status, or throws. */
async function waitFor(port, what, pred, timeoutMs) {
  const end = Date.now() + timeoutMs
  let last = null
  while (Date.now() < end) {
    const s = await status(port)
    if (s) last = s
    if (s && pred(s)) return s
    await sleep(1000)
  }
  throw new Error(`Zeitüberschreitung: ${what} (zuletzt: ${last ? last.phase : 'keine Antwort'})`)
}

function leftovers(dir) {
  return readdirSync(dir).filter((f) => /\.old\.|\.new$|update-failed\.json/.test(f))
}

async function shutdown(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/shutdown`, { method: 'POST' })
  } catch {
    // Already gone is fine.
  }
}

const results = []
function check(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${detail}`)
}

async function scenario(sc) {
  const dir = path.join(root, `installed-${sc.name}`)
  const exe = path.join(dir, 'tandem.exe')
  const exeSize = statSync(exe).size
  console.log(`\n== ${sc.name} (Port ${sc.port}) ==`)
  spawn(exe, [], {
    detached: true, stdio: 'ignore',
    env: { ...process.env, TANDEM_RELEASE_URL: sc.url, PORT: String(sc.port) },
  }).unref()

  try {
    const start = await waitFor(sc.port, 'Server startet', () => true, 60_000)
    check(sc.name, start.currentVersion === setup.installedVersion,
      `startet als ${start.currentVersion}`)

    if (sc.name === 'offline') {
      const s = await waitFor(sc.port, 'Prüfung scheitert', (x) => x.phase === 'check-failed', 30_000)
      check(sc.name, s.phase === 'check-failed', 'Prüfung scheitert ruhig (check-failed), kein Update')
      return
    }

    await waitFor(sc.port, 'Update gefunden', (x) => x.phase === 'available', 30_000)
    check(sc.name, true, `Update ${setup.releaseVersion} gefunden`)
    await post(sc.port, '/api/update/download')

    if (sc.name === 'checksum') {
      const s = await waitFor(sc.port, 'Download abgelehnt',
        (x) => x.phase === 'download-failed' || x.phase === 'ready', 300_000)
      check(sc.name, s.phase === 'download-failed' && /Prüfsumme/.test(s.error ?? ''),
        `Download abgelehnt: ${s.error}`)
      check(sc.name, statSync(exe).size === exeSize, 'installierte exe unverändert')
      return
    }

    await waitFor(sc.port, 'Download fertig', (x) => x.phase === 'ready', 300_000)
    check(sc.name, true, 'heruntergeladen und geprüft')
    await post(sc.port, '/api/update/install')

    // Back up means: a server answers that is no longer installing.
    const after = await waitFor(sc.port, 'Neustart',
      (x) => x.phase !== 'installing' && x.phase !== 'ready', 240_000)

    if (sc.name === 'ok') {
      check(sc.name, after.currentVersion === setup.releaseVersion,
        `läuft nach dem Neustart als ${after.currentVersion}`)
      const release = statSync(path.join(root, 'release', 'tandem.exe')).size
      check(sc.name, statSync(exe).size === release, 'tandem.exe ist jetzt die Release-Datei')
    } else {
      check(sc.name, after.currentVersion === setup.installedVersion,
        `zurückgerollt, läuft wieder als ${after.currentVersion}`)
      check(sc.name, after.phase === 'install-failed', `Phase ${after.phase}: ${after.error}`)
      check(sc.name, statSync(exe).size === exeSize, 'tandem.exe wieder in der alten Größe')
    }
    // The new process tidies the .old files a few seconds after it starts.
    await sleep(8000)
    const left = leftovers(dir)
    check(sc.name, left.length === 0, left.length ? `Reste: ${left.join(', ')}` : 'keine .old/.new-Reste')
  } catch (err) {
    check(sc.name, false, String(err.message ?? err))
  } finally {
    await shutdown(sc.port)
  }
}

if (!existsSync(path.join(root, 'release'))) {
  console.error(`Kein Setup unter ${root}. Erst: node scripts/update-test/setup.mjs`)
  process.exit(1)
}

const fake = spawn(process.execPath, [
  path.join(repo, 'scripts', 'update-test', 'fake-release-server.mjs'), root, String(setup.fakePort),
], { stdio: 'ignore' })
await sleep(3000)

try {
  for (const sc of setup.scenarios) await scenario(sc)
} finally {
  fake.kill()
}

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} Prüfungen bestanden`)
process.exit(failed.length === 0 ? 0 : 1)
