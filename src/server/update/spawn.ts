import path from 'path'
import { spawn } from 'child_process'

/**
 * The environment the replacement process starts with.
 *
 * TANDEM_RESTART tells it it is a replacement, not a second copy: on a busy
 * port it must retry the bind instead of deferring to whatever is answering
 * there (see the EADDRINUSE handler in main.ts). This process may still be
 * holding the port at that instant — if closeServer threw before its listener
 * unbound — and a child that politely gives up would leave the landing site
 * with nothing running at all.
 *
 * PKG_EXECPATH is set to an empty string on purpose. pkg patches spawn() and,
 * when the env carries no PKG_EXECPATH, writes the running exe's own path into
 * it. A pkg exe that finds its own path there believes it was started as plain
 * `node <script>` and takes argv[1] as the script — with no argument, Node dies
 * at once with 'The "paths[0]" argument must be of type string. Received
 * undefined'. Because the new tandem.exe sits at the very path the old one was
 * started from, that is exactly what happened in the first manual update test.
 * Any defined value makes pkg leave the variable alone, and an empty one never
 * matches, so the child runs its own bundled entry point as a double-click
 * would.
 */
export function restartEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...base, TANDEM_RESTART: '1', PKG_EXECPATH: '' }
}

/** Starts exePath detached from this process, which is about to exit. */
export function spawnDetached(exePath: string): { kill: () => void } {
  const child = spawn(exePath, [], {
    detached: true, stdio: 'ignore', cwd: path.dirname(exePath), windowsHide: true,
    env: restartEnv(process.env),
  })
  child.unref()
  return { kill: () => child.kill() }
}
