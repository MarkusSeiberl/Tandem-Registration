/**
 * True once `probe` answers true — the new process is up — or false when the
 * time runs out.
 *
 * The timers here must keep the process alive. installUpdate calls this after
 * closeServer() has shut the listener, Bonjour and the database, and after the
 * child was spawned detached and unref'd: nothing else is left holding the
 * event loop open. Unref'd timers would let Node exit quietly with code 0
 * mid-wait — no health verdict, no rollback, the swapped files left in place
 * and nothing running. That is exactly what the first manual update test hit
 * with a release exe that did not start.
 */
export function waitForHealth(
  probe: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = async () => {
      if (await probe()) return resolve(true)
      if (Date.now() >= deadline) return resolve(false)
      setTimeout(tick, intervalMs)
    }
    // A moment's grace: the child has to get as far as listen() first.
    setTimeout(tick, intervalMs)
  })
}
