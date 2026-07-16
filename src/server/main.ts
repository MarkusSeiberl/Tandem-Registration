import path from 'path'
import fs from 'fs'
import os from 'os'
import { Bonjour } from 'bonjour-service'
import { openDb } from './db'
import { loadConfig, saveConfig } from './config'
import { buildServer } from './index'
import { registerStatic } from './static'

const isPackaged = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined'

const installDir = isPackaged ? path.dirname(process.execPath) : process.cwd()

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

const db = openDb(path.join(dir, 'tandem.db'), nativeBinding)
const cfgRef = { current: loadConfig(dir) }
const app = buildServer(db, cfgRef, (c) => saveConfig(dir, c))

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

app.listen({ port, host: '0.0.0.0' }).then(() => {
  bonjour = new Bonjour()
  bonjour.publish({ name: 'tandem', type: 'http', port })
  console.log(`Tandem läuft auf http://tandem.local:${port} (lokales Netzwerk, kein Internet nötig)`)
}).catch((err) => {
  console.error('[tandem] Start fehlgeschlagen:', err.message)
  process.exit(1)
})
