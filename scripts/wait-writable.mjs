// Waits until a freshly written file can be opened for writing.
//
// Windows Defender scans a new, unsigned 114 MB exe right after pkg writes it
// and holds it open meanwhile. The post-processing steps that follow
// (patch-subsystem.mjs, patch-version-info.mjs) open it for writing and died
// with EBUSY whenever they ran inside that window. The lock lasts a few
// seconds, so build-exe.mjs waits it out once here instead of every step
// retrying on its own.
//
// Dependency-free by design, like the other build scripts.

import { openSync, closeSync } from 'node:fs';

/** Error codes Windows reports for a file another process holds open. */
const LOCKED = new Set(['EBUSY', 'EPERM', 'EACCES']);

/**
 * Resolves once `filePath` opens with 'r+'. Retries only while the file is
 * locked; any other error (a missing file, say) is thrown at once. Throws a
 * readable error once `timeoutMs` has passed.
 *
 * `open`, `sleep` and `now` exist for the tests.
 */
export async function waitUntilWritable(filePath, {
  timeoutMs = 60_000,
  intervalMs = 500,
  open = (p) => closeSync(openSync(p, 'r+')),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  const deadline = now() + timeoutMs;
  for (;;) {
    try {
      open(filePath);
      return;
    } catch (err) {
      if (!LOCKED.has(err.code)) throw err;
      if (now() >= deadline) {
        throw new Error(
          `${filePath} is still locked after ${Math.round(timeoutMs / 1000)} s (${err.code}). ` +
            'Is tandem.exe running, or is a virus scanner holding it?',
        );
      }
      await sleep(intervalMs);
    }
  }
}
