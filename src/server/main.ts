import path from 'path'
import fs from 'fs'
import os from 'os'
import { exec } from 'child_process'
import { Bonjour } from 'bonjour-service'
import { openDb } from './db'
import { loadConfig, saveConfig } from './config'
import { buildServer } from './index'
import { registerStatic } from './static'
import { notifyRegistration } from './notify'
import { pickPathWindows } from './pickPathWin'
import { assetPath, installDir, isPackaged } from './assets'
import { FONT_ASSETS } from './contractPdf'

const dir = process.env.DIR || installDir

// In the packaged exe, better-sqlite3's native binary ships as a real file next
// to the exe (pkg can't dlopen it from the virtual snapshot). In dev, let
// better-sqlite3 resolve it normally from node_modules.
const nativeBinding = isPackaged ? path.join(installDir, 'better_sqlite3.node') : undefined

// Fail fast with an actionable message if the native binary isn't beside the
// exe, instead of a raw MODULE_NOT_FOUND from deep inside better-sqlite3.
if (nativeBinding && !fs.existsSync(nativeBinding)) {
  console.error(
    `\n[tandem] Start fehlgeschlagen: SQLite-Datei nicht gefunden.\n` +
      `Erwartet wird die Datei genau hier (neben tandem.exe):\n` +
      `  ${nativeBinding}\n\n` +
      `Bitte 'better_sqlite3.node' (exakt dieser Name) in denselben Ordner\n` +
      `wie tandem.exe legen. Aktueller Ordnerinhalt:\n` +
      (fs.existsSync(installDir)
        ? fs.readdirSync(installDir).map((f) => `  - ${f}`).join('\n')
        : `  (Ordner ${installDir} nicht lesbar)`) +
      `\n`,
  )
  process.exit(1)
}

const contractTemplate = fs.readFileSync(assetPath('Befoerderungsvertrag.pdf'))

// The fonts the contract is drawn with are only opened when the first guest
// signs. A missing one would surface there as a failed registration in front of
// a waiting guest — the very failure the embedded font was added to end — so it
// is checked while nobody is standing at the tablet.
const missingFonts = FONT_ASSETS.filter((name) => !fs.existsSync(assetPath(name)))
if (missingFonts.length > 0) {
  const many = missingFonts.length > 1
  console.error(
    `\n[tandem] Start fehlgeschlagen: Schriftdatei${many ? 'en' : ''} nicht gefunden.\n` +
      `Ohne sie kann kein Beförderungsvertrag gedruckt werden.\n` +
      `${many ? 'Diese Dateien fehlen' : 'Diese Datei fehlt'}:\n` +
      missingFonts.map((name) => `  - ${assetPath(name)}`).join('\n') +
      `\n`,
  )
  process.exit(1)
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
const app = buildServer(db, cfgRef, contractTemplate, (c) => saveConfig(dir, c), notify, pickPath)

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
if (isPackaged) {
  // Assets are embedded at <snapshot>/web (relative to the config file dir);
  // the bundled server.cjs lives at <snapshot>/dist, so `web` is one level up.
  const embeddedWeb = path.join(__dirname, '..', 'web')
  webRoot = path.join(os.tmpdir(), 'tandem-web')
  try {
    extractDir(embeddedWeb, webRoot)
  } catch (err) {
    console.error('[tandem] Konnte eingebettete Web-Dateien nicht entpacken:', err)
  }
} else {
  webRoot = path.join(installDir, 'web')
}

registerStatic(app, webRoot)

const port = Number(process.env.PORT) || 80

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

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// Best-effort: open the manifest screen in the default browser. Only done for
// the packaged .exe — auto-popping a browser window on every `npm start` or
// e2e test run (which also boots this file via tsx) would be disruptive.
function openBrowser(url: string) {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`
  exec(cmd, (err) => {
    if (err) console.error('[tandem] Konnte Browser nicht automatisch öffnen:', err.message)
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

app.listen({ port, host: '0.0.0.0' }).then(() => {
  bonjour = new Bonjour()
  // Advertise an A record for `tandem.local` itself (host), not just a
  // `_http._tcp` service under the machine's own hostname — otherwise nothing
  // maps the name `tandem.local` to an IP and browsers can't resolve it. Note
  // mDNS/.local is still unreliable across firewalls, virtual adapters and
  // Android, so the banner below leads with localhost + the raw LAN IP.
  bonjour.publish({ name: 'tandem', type: 'http', port, host: 'tandem.local' })

  const p = port === 80 ? '' : `:${port}`
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
}).catch((err) => {
  console.error('[tandem] Start fehlgeschlagen:', err.message)
  process.exit(1)
})
