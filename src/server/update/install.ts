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

  const child = deps.spawnDetached(exePath)
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
}
