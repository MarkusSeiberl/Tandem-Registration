import path from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import { exec, execFileSync } from 'child_process'
import { Bonjour } from 'bonjour-service'
import { openDb } from './db'
import { loadConfig, saveConfig } from './config'
import { buildServer } from './index'
import { registerStatic } from './static'
import { notifyRegistration } from './notify'
import { pickPathWindows } from './pickPathWin'
import { assetPath, installDir, isPackaged } from './assets'
import { FONT_ASSETS } from './contractPdf'
import { APP_VERSION } from './version'
import { UpdateState } from './update/state'
import { fetchLatestRelease } from './update/github'
import { downloadRelease, defaultFetchStream, removePartials } from './update/download'
import { cleanupLeftovers, takeFailureMarker, installUpdate } from './update/install'
import { waitForHealth } from './update/health'
import { spawnDetached } from './update/spawn'
import type { UpdateControls } from './routes/update'

const dir = process.env.DIR || installDir

// An interrupted update can leave rollback copies and half-finished downloads
// behind. That this process is running at all proves the files on disk start,
// so the copies have done their job. This runs before anything else opens —
// including the better_sqlite3.node existence check below — so a half-loaded
// download is never reported as a missing file.
if (isPackaged) {
  try {
    // Started by installUpdate, the old process is still running from
    // tandem.old.exe until it has seen this one answer, and Windows will not
    // delete a running image. Try again every 2 s for a minute; unref'd, as
    // the server keeps the process alive anyway.
    if (!cleanupLeftovers(installDir) && process.env.TANDEM_RESTART === '1') {
      let attempts = 0
      const retry = setInterval(() => {
        if (cleanupLeftovers(installDir) || ++attempts >= 30) clearInterval(retry)
      }, 2000)
      retry.unref()
    }
  } catch (err) {
    console.error('[tandem] Aufräumen nach Update fehlgeschlagen:', err)
  }
}

/**
 * Ends the program on a problem the operator has to fix.
 *
 * The shipped exe is patched to the Windows GUI subsystem so it starts without
 * a terminal (see scripts/patch-subsystem.mjs), which also means it has no
 * console to print to: a `console.error` before `process.exit(1)` would make
 * the exe die completely silently. So the packaged build additionally puts the
 * message in a Windows message box. In dev the console is the message box.
 */
function fatal(message: string): never {
  console.error(message)
  if (isPackaged && process.platform === 'win32') {
    // The text travels as base64 so quotes, umlauts and newlines in it cannot
    // break out of the PowerShell command; the command itself is passed as
    // -EncodedCommand (UTF-16LE base64), the documented quoting-proof form.
    const b64 = Buffer.from(message, 'utf8').toString('base64')
    const script =
      `Add-Type -AssemblyName System.Windows.Forms;` +
      `$m=[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${b64}'));` +
      `[System.Windows.Forms.MessageBox]::Show($m,'Tandem',0,16)|Out-Null`
    try {
      execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64')],
        { windowsHide: true, stdio: 'ignore' },
      )
    } catch {
      // A message box is a courtesy — never let it mask the actual failure.
    }
  }
  process.exit(1)
}

// In the packaged exe, better-sqlite3's native binary ships as a real file next
// to the exe (pkg can't dlopen it from the virtual snapshot). In dev, let
// better-sqlite3 resolve it normally from node_modules.
const nativeBinding = isPackaged ? path.join(installDir, 'better_sqlite3.node') : undefined

// Fail fast with an actionable message if the native binary isn't beside the
// exe, instead of a raw MODULE_NOT_FOUND from deep inside better-sqlite3.
if (nativeBinding && !fs.existsSync(nativeBinding)) {
  fatal(
    `[tandem] Start fehlgeschlagen: SQLite-Datei nicht gefunden.\n` +
      `Erwartet wird die Datei genau hier (neben tandem.exe):\n` +
      `  ${nativeBinding}\n\n` +
      `Bitte 'better_sqlite3.node' (exakt dieser Name) in denselben Ordner\n` +
      `wie tandem.exe legen. Aktueller Ordnerinhalt:\n` +
      (fs.existsSync(installDir)
        ? fs.readdirSync(installDir).map((f) => `  - ${f}`).join('\n')
        : `  (Ordner ${installDir} nicht lesbar)`),
  )
}

const contractTemplate = fs.readFileSync(assetPath('Befoerderungsvertrag.pdf'))

// The fonts the contract is drawn with are only opened when the first guest
// signs. A missing one would surface there as a failed registration in front of
// a waiting guest — the very failure the embedded font was added to end — so it
// is checked while nobody is standing at the tablet.
const missingFonts = FONT_ASSETS.filter((name) => !fs.existsSync(assetPath(name)))
if (missingFonts.length > 0) {
  const many = missingFonts.length > 1
  fatal(
    `[tandem] Start fehlgeschlagen: Schriftdatei${many ? 'en' : ''} nicht gefunden.\n` +
      `Ohne sie kann kein Beförderungsvertrag gedruckt werden.\n` +
      `${many ? 'Diese Dateien fehlen' : 'Diese Datei fehlt'}:\n` +
      missingFonts.map((name) => `  - ${assetPath(name)}`).join('\n'),
  )
}

const db = openDb(path.join(dir, 'tandem.db'), nativeBinding)
const cfgRef = { current: loadConfig(dir) }
// Only the shipped exe pops desktop toasts — a dev `npm start`, the e2e run
// (also boots this file) and unit tests (which use buildServer directly, never
// passing a notifier) stay quiet.
const notify = isPackaged ? notifyRegistration : undefined
// The path dialogs are Windows dialogs. On any other system the settings screen
// simply keeps its text fields — see src/server/routes/pickPath.ts.
const pickPath = process.platform === 'win32' ? pickPathWindows : undefined
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

// The manifest's "Programm beenden" button ends up here — the same orderly
// shutdown as Strg+C, so Bonjour is unpublished and the database closes cleanly
// instead of the operator killing the console window.
const app = buildServer(db, cfgRef, contractTemplate, (c) => saveConfig(dir, c), notify, pickPath,
  () => { void shutdown('Beenden über das Manifest') }, updateControls)

app.get('/api/contract', async () => ({ text: cfgRef.current.contractText }))

// The web frontends are embedded INTO the exe as pkg assets. @fastify/static
// can't reliably read from pkg's virtual /snapshot filesystem, so on startup we
// extract the embedded `web/` tree to a real temp dir and serve from there.
// (readdirSync/statSync/readFileSync all work against pkg's snapshot.) In dev,
// the built assets sit in `installDir/web` and are served directly.
function extractDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dest, name)
    if (fs.statSync(s).isDirectory()) extractDir(s, d)
    else fs.writeFileSync(d, fs.readFileSync(s))
  }
}

let webRoot: string
// Runs once the port is ours — see the call site below for why it is not done
// here.
let extractWeb = () => {}
if (isPackaged) {
  // Assets are embedded at <snapshot>/web (relative to the config file dir);
  // the bundled server.cjs lives at <snapshot>/dist, so `web` is one level up.
  const embeddedWeb = path.join(__dirname, '..', 'web')
  webRoot = path.join(os.tmpdir(), 'tandem-web')
  // The folder is created empty right away because @fastify/static needs its
  // root to exist at registration time. Filling it is deferred until the
  // listen succeeds: a second start that finds Tandem already running must not
  // rewrite the very files the running instance is serving to the tablets.
  fs.mkdirSync(webRoot, { recursive: true })
  extractWeb = () => {
    try {
      extractDir(embeddedWeb, webRoot)
    } catch (err) {
      console.error('[tandem] Konnte eingebettete Web-Dateien nicht entpacken:', err)
    }
  }
} else {
  webRoot = path.join(installDir, 'web')
}

registerStatic(app, webRoot)

const port = Number(process.env.PORT) || 80
// Port 80 is the default so the tablets' URLs carry no port at all.
const p = port === 80 ? '' : `:${port}`

let bonjour: Bonjour | undefined
let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[tandem] ${signal} empfangen, fahre herunter...`)
  try {
    if (bonjour) {
      await new Promise<void>((resolve) => {
        bonjour!.unpublishAll(() => {
          bonjour!.destroy(() => resolve())
        })
      })
    }
  } catch (err) {
    console.error('[tandem] Fehler beim Beenden von Bonjour:', err)
  }
  try {
    await app.close()
  } catch (err) {
    console.error('[tandem] Fehler beim Beenden des Servers:', err)
  }
  process.exit(0)
}

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

async function runInstall() {
  if (updateState.get().phase !== 'ready' || updateBusy) return
  updateBusy = true
  updateState.patch({ phase: 'installing', error: null })
  try {
    await installUpdate({
      dir: installDir,
      // Each step is guarded on its own so a failure early in the teardown
      // cannot stop the listener from closing. Bonjour failing to unpublish
      // must not leave the port held and the swap half-done; installUpdate
      // catches a rejection from here, but the cleanest outcome is for this
      // to get as far as it can and let the swap proceed.
      closeServer: async () => {
        try {
          if (bonjour) {
            await new Promise<void>((resolve) => {
              bonjour!.unpublishAll(() => bonjour!.destroy(() => resolve()))
            })
          }
        } catch (err) {
          console.error('[tandem] Bonjour ließ sich nicht abmelden:', err)
        }
        try {
          await app.close()
        } catch (err) {
          console.error('[tandem] Server ließ sich nicht sauber schließen:', err)
        }
        try {
          db.close()
        } catch (err) {
          console.error('[tandem] Datenbank ließ sich nicht sauber schließen:', err)
        }
      },
      spawnDetached,
      // True once a Tandem answers on our port again — the new process is up.
      waitForHealth: (timeoutMs) => waitForHealth(tandemAlreadyRunning, timeoutMs),
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

// Recovers what a previous, interrupted attempt learned about its own failure
// — read once and deleted, so it cannot reappear on every future start. Guarded
// like cleanupLeftovers above: takeFailureMarker's rmSync(..., { force: true })
// only swallows a missing file, not one a virus scanner or backup tool has
// locked, and a throw here must never stop the server from going on to listen.
let failure: string | null = null
if (isPackaged) {
  try {
    failure = takeFailureMarker(installDir)
  } catch (err) {
    console.error('[tandem] Fehlermeldung des letzten Updates konnte nicht gelesen werden:', err)
  }
}
if (failure) updateState.fail('install-failed', failure)

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// Best-effort: open the manifest screen in the default browser. Only done for
// the packaged .exe — auto-popping a browser window on every `npm start` or
// e2e test run (which also boots this file via tsx) would be disruptive.
function openBrowser(url: string, done?: () => void) {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`
  // windowsHide keeps the cmd.exe that runs `start` from flashing a window up
  // — visible now that the exe itself no longer owns a console.
  exec(cmd, { windowsHide: true }, (err) => {
    if (err) console.error('[tandem] Konnte Browser nicht automatisch öffnen:', err.message)
    done?.()
  })
}

/** True if a Tandem server already answers on this port of this machine. */
function tandemAlreadyRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/api/health', timeout: 2000 },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { body += chunk })
        res.on('end', () => {
          try {
            resolve((JSON.parse(body) as { ok?: boolean }).ok === true)
          } catch {
            resolve(false)
          }
        })
      },
    )
    // Anything else on the port (IIS, another web server) fails one of these.
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
  })
}

// The machine's non-internal IPv4 addresses — the reliable way for other
// devices (incl. Android, which does not resolve mDNS .local names) to reach
// the server. A machine with Hyper-V/WSL/VPN adapters lists several; the
// operator picks the one on the same Wi-Fi/LAN as the tablets.
function lanIPv4(): string[] {
  const out: string[] = []
  for (const nis of Object.values(os.networkInterfaces())) {
    for (const ni of nis ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
    }
  }
  return out
}

// Runs once listen() has actually bound the port — whether on the very first
// try, or after the TANDEM_RESTART retry loop in the .catch() below finds the
// port free. Pulled into a named function so both paths run the identical
// Bonjour-publish/extractWeb/banner/browser sequence instead of a second copy
// of the block.
function afterListen() {
  extractWeb()
  bonjour = new Bonjour()
  // Advertise an A record for `tandem.local` itself (host), not just a
  // `_http._tcp` service under the machine's own hostname — otherwise nothing
  // maps the name `tandem.local` to an IP and browsers can't resolve it. Note
  // mDNS/.local is still unreliable across firewalls, virtual adapters and
  // Android, so the banner below leads with localhost + the raw LAN IP.
  bonjour.publish({ name: 'tandem', type: 'http', port, host: 'tandem.local' })

  console.log('')
  console.log('==============================================')
  console.log('  Tandem läuft und ist einsatzbereit!')
  console.log('==============================================')
  console.log('')
  console.log('  Auf DIESEM Rechner:')
  console.log(`    Gäste-Anmeldung:  http://localhost${p}/guest`)
  console.log(`    Manifest:         http://localhost${p}/manifest`)
  console.log('')
  console.log('  Von anderen Geräten im selben WLAN/LAN:')
  const ips = lanIPv4()
  if (ips.length === 0) {
    console.log('    (keine Netzwerk-Adresse gefunden — mit WLAN/LAN verbinden)')
  } else {
    for (const ip of ips) {
      console.log(`    http://${ip}${p}/guest   bzw.   http://${ip}${p}/manifest`)
    }
  }
  console.log(`    (falls unterstützt auch: http://tandem.local${p}/guest)`)
  console.log('')
  console.log('  Hinweis: Beim ersten Start die Windows-Firewall-Abfrage')
  console.log('  fuer "tandem" im PRIVATEN Netzwerk zulassen.')
  console.log('')
  console.log('  (lokales Netzwerk, kein Internet nötig)')
  console.log('')
  console.log('  Zum Beenden dieses Fenster schließen oder STRG+C drücken.')
  console.log('')
  if (isPackaged) openBrowser(`http://localhost${p}/manifest`)

  if (isPackaged) {
    // A second's grace so listen, Bonjour and the browser launch come first;
    // the query itself is async and times out after 5 s, so tablets are never
    // held up. Unref'd so neither timer keeps the process alive. A site
    // without internet notices nothing. The manifest refetches its status when
    // the find is pushed, so a page opened before the check still gets the
    // dialog (see web/manifest/src/App.tsx).
    setTimeout(() => { void runCheck(true) }, 1000).unref?.()
    setInterval(() => { void runCheck(false) }, 60 * 60 * 1000).unref?.()
  }
}

app.listen({ port, host: '0.0.0.0' }).then(afterListen).catch(async (err: NodeJS.ErrnoException) => {
  // Started by installUpdate as a replacement: the port is expected to be busy
  // for a moment, because the process we are replacing is still shutting down.
  // Retry instead of deferring — deferring would end with nobody serving.
  if (err.code === 'EADDRINUSE' && process.env.TANDEM_RESTART === '1') {
    const deadline = Date.now() + 60_000
    // Explicit flag to distinguish "never attempted to bind" from "bind failed".
    // The two states must not share a representation on the one path whose job
    // is to guarantee something is listening. Only the bind outcome belongs in
    // this try — afterListen() is called below it, so a failure there
    // (extractWeb, bonjour.publish — real synchronous I/O) is never mistaken
    // for the port still being occupied.
    let bound = false
    let lastErr: NodeJS.ErrnoException | undefined
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500))
      try {
        await app.listen({ port, host: '0.0.0.0' })
        bound = true
        break
      } catch (retryErr) {
        lastErr = retryErr as NodeJS.ErrnoException
        if (lastErr.code !== 'EADDRINUSE') break
      }
    }
    if (bound) {
      // Bound after all — carry on as a normal start. Caught separately, not
      // folded into the retry's try above, so a throw here reports its own
      // message instead of the misleading "Port blieb belegt".
      try {
        afterListen()
      } catch (afterErr) {
        fatal(`[tandem] Start fehlgeschlagen: ${(afterErr as Error).message}`)
      }
      return
    }
    if (lastErr?.code === 'EADDRINUSE') {
      fatal(
        `[tandem] Neustart nach dem Update fehlgeschlagen: Port ${port} blieb belegt.\n` +
          `Die vorherige Version läuft möglicherweise noch. Tandem bitte von Hand starten.`,
      )
    }
    if (lastErr) {
      fatal(
        `[tandem] Neustart nach dem Update fehlgeschlagen: ${lastErr.message}\n` +
          `Tandem bitte von Hand starten.`,
      )
    }
    fatal(
      `[tandem] Neustart nach dem Update fehlgeschlagen: Port ${port} wurde nicht frei.\n` +
        `Tandem bitte von Hand starten.`,
    )
  }
  // Starting tandem.exe a second time is how the operator gets the manifest
  // page back after closing the browser tab — the exe has no console and no
  // taskbar window any more, so there is nothing else left to click. The port
  // is taken by our own first instance, so we land here; reopen the page and
  // leave that instance running, untouched.
  if (err.code === 'EADDRINUSE' && await tandemAlreadyRunning()) {
    openBrowser(`http://localhost${p}/manifest`, () => process.exit(0))
    return
  }
  if (err.code === 'EADDRINUSE') {
    fatal(
      `[tandem] Start fehlgeschlagen: Port ${port} ist belegt.\n` +
        `Ein anderes Programm (z. B. IIS, Skype oder ein Webserver) hört bereits\n` +
        `auf diesem Port. Dieses Programm beenden — oder Tandem auf einem anderen\n` +
        `Port starten:  set PORT=8080 && tandem.exe`,
    )
  }
  fatal(`[tandem] Start fehlgeschlagen: ${err.message}`)
})
