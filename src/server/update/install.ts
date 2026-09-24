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
  /**
   * Starts exePath as a new detached process and returns a handle to it.
   *
   * The process this starts MUST NOT defer to whatever is already answering on
   * the port — the way main.ts's own EADDRINUSE handling does when it finds a
   * healthy Tandem there and reopens the browser instead of erroring. That
   * behaviour exists for an operator double-clicking the exe; it is wrong here.
   * installUpdate can still be holding the port at the instant this is called
   * (see the comment on closeServer() throwing, further down in this file), so
   * the process being started here may find the port busy and its own
   * predecessor answering "healthy" for a moment — not a second instance, but
   * this one on its way out. A child that concludes "busy and healthy, another
   * copy must be running" and exits 0 would leave nothing running once this
   * process then dies too: this is a replacement, not a second copy. The
   * implementation must instead retry binding the port until it frees or a
   * timeout elapses.
   *
   * The signature only carries exePath. If the implementation needs to tell
   * "started as an update restart, please retry the bind" apart from an
   * operator's ordinary double-click, it is free to arrange that itself — e.g.
   * an environment variable it sets on the child it spawns — without any
   * change to this module.
   */
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
 *
 * Returns true when nothing is left. Right after an update it is false: the
 * old process is still running from tandem.old.exe and has the old .node
 * loaded, and Windows will not delete either until it exits. The restarted
 * process calls this again until it succeeds.
 */
export function cleanupLeftovers(dir: string): boolean {
  let clean = true
  for (const name of [OLD_EXE, OLD_NATIVE, EXE_NAME + NEW_SUFFIX, NATIVE_NAME + NEW_SUFFIX]) {
    const filePath = path.join(dir, name)
    try {
      fs.rmSync(filePath, { force: true })
    } catch (err) {
      // force: true suppresses "file does not exist" errors but not file-locking errors
      // (EBUSY, EPERM, EACCES on Windows from antivirus, backup agents, or indexers).
      // This runs before listen(), so a throw here means the program does not start.
      // Try to remove each file independently so one locked file does not prevent
      // cleaning up the others.
      console.warn(`Datei konnte nicht gelöscht werden: ${filePath} — ${String(err)}`)
      clean = false
    }
  }
  return clean
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
  try {
    fs.rmSync(file, { force: true })
  } catch (err) {
    // force: true suppresses "file does not exist" errors but not file-locking errors
    // (EBUSY, EPERM, EACCES on Windows from antivirus, backup agents, or indexers).
    // This runs before listen(), so a throw here means the program does not start.
    // Return the reason we read; the file will persist, meaning the same reason
    // shows again on the next start until the file can be deleted — annoying but
    // not fatal, and clearly better than failing to start.
    console.warn(`Datei konnte nicht gelöscht werden: ${file} — ${String(err)}`)
  }
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
    if (!fs.existsSync(file)) throw new Error(`„${name + NEW_SUFFIX}“ fehlt — bitte neu laden.`)
  }

  // From this point on the server is meant to be gone and nothing listening. Every
  // region below — closeServer() included — must end in one of the module's two
  // defined outcomes — the new version running, or the old one restored and
  // running — never in a third outcome where an unhandled throw leaves this
  // process alive with a closed (or half-closed) server and no restart. That is
  // indistinguishable from a dead installation to an operator at the landing site,
  // so closeServer() itself sits inside the catch-all recovery below, not before it.
  let child: { kill: () => void } | undefined
  // Tracks whether the rename block below ever completed, so the catch-all's
  // marker text can say what actually happened instead of always claiming a
  // restore: closeServer() throwing, or the stale-.old sweep throwing, both
  // happen before anything is touched on disk, and "restored" would be false.
  let renamed = false
  try {
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
        JSON.stringify({ reason: `Dateien konnten nicht getauscht werden: „${String(err)}“` }),
      )
      deps.spawnDetached(exePath)
      deps.exit(1)
      return
    }
    renamed = true

    child = deps.spawnDetached(exePath)
    // 90 s, not 30: Windows Defender can scan a freshly written, unsigned 114 MB
    // binary before it is allowed to run. A genuinely broken exe fails in seconds
    // anyway, so the long wait only ever costs us in the rare real failure.
    const healthy = await deps.waitForHealth(deps.healthTimeoutMs ?? 90_000)

    if (healthy) {
      // tandem.old.exe is this very process's image and better_sqlite3.old.node
      // is loaded in it; Windows refuses to delete either while this runs
      // (EPERM). The update has succeeded at this point, so a failed delete
      // must not fall through to the catch-all below — that would kill the
      // healthy new version and roll back. The new process removes what is
      // left once this one is gone (cleanupLeftovers, retried in main.ts).
      for (const [, old] of PAIRS) {
        try {
          fs.rmSync(path.join(dir, old), { force: true })
        } catch {
          // Left for the new process — see above.
        }
      }
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
    // Anything unexpected past this point — closeServer() itself throwing, the
    // stale-.old sweep, spawnDetached, or waitForHealth itself throwing instead of
    // resolving to false — leaves the new version's health unknown. Unknown must
    // fall back to the version known to work, so this performs the same recovery
    // as the unhealthy-child path above. It is deliberately tolerant of its OWN
    // failures (each step wrapped separately): if restore() or the marker write
    // also throws, a best-effort restart of whatever exe is on disk still beats
    // letting this become an unhandled rejection with no server and nothing
    // running.
    //
    // If closeServer() throws before its HTTP listener has actually closed, this
    // process can still be holding the port at the moment spawnDetached below
    // starts a new copy of the exe — and can even still be answering /api/health
    // for the instant it takes exit() to actually tear this process down. Waiting
    // it out here is not an option: exit() is synchronous and this whole branch is
    // best-effort, with no room for a "wait for the port to free, then spawn"
    // step. Safety instead rests entirely on the spawnDetached contract (see
    // InstallDeps.spawnDetached above): the process it starts must retry binding
    // the port until it frees, never defer to whatever answers there in the
    // meantime. A child that deferred — the way main.ts's own EADDRINUSE handling
    // does for a double-clicking operator — could see "busy and healthy" (this
    // dying process, not a second instance), exit 0, and then this process exits
    // too, leaving nothing running.
    try { child?.kill() } catch { /* best effort — see comment above */ }
    try { restore(dir) } catch { /* best effort — see comment above */ }
    try {
      // renamed is only true once the rename block above has fully completed,
      // so this tells the operator the truth for both cases: nothing was ever
      // touched (closeServer() or the stale-.old sweep threw first), versus a
      // swap that did happen and was rolled back by restore() just above.
      const reason = renamed
        ? `Unerwarteter Fehler bei der Installation: „${String(err)}“. Die vorherige ` +
          'Version wurde, soweit möglich, wiederhergestellt und gestartet.'
        : `Unerwarteter Fehler bei der Installation: „${String(err)}“. An der Installation ` +
          'wurde nichts verändert. Die vorherige Version wurde neu gestartet.'
      fs.writeFileSync(
        path.join(dir, FAILURE_MARKER),
        JSON.stringify({ reason }),
      )
    } catch { /* best effort — see comment above */ }
    try { deps.spawnDetached(exePath) } catch { /* best effort — see comment above */ }
    deps.exit(1)
  }
}
