import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { pipeline } from 'stream/promises'
import { Readable, Transform } from 'stream'
import { EXE_NAME, NATIVE_NAME } from './github'
import type { Release, ReleaseAsset } from './github'

/** Both files land beside the running exe under this suffix. */
export const NEW_SUFFIX = '.new'

export interface DownloadDeps {
  /** Where tandem.exe lives. The download MUST land on the same volume: the
   *  install step renames, and a rename across volumes is a copy that can fail
   *  halfway through, with the running exe already gone. */
  dir: string
  fetchStream: (url: string) => Promise<NodeJS.ReadableStream>
  onProgress: (downloadedBytes: number, totalBytes: number) => void
  freeBytes?: (dir: string) => number
}

function defaultFreeBytes(dir: string): number {
  // statfsSync throws (ENOENT if `dir` is missing, or some other native error
  // on a filesystem that does not implement statfs at all) rather than
  // returning a sentinel. Left uncaught, that is a raw English Node error on
  // an operator's screen -- exactly what this module exists to prevent.
  //
  // Failing closed here, rather than treating "unknown" as "space is fine":
  // `dir` is where the running exe already lives, so the probe failing means
  // something is wrong with that directory itself (deleted out from under
  // the program, unreadable, an exotic filesystem), and that same problem
  // would very likely also break the write that follows. Starting a
  // multi-hundred-megabyte download over a landing site's often-slow link
  // only to fail later for the same underlying reason wastes the operator's
  // time and bandwidth for nothing; refusing immediately, in German, with
  // the directory named, at least tells them where to look.
  try {
    const st = fs.statfsSync(dir)
    return Number(st.bsize) * Number(st.bavail)
  } catch {
    throw new Error(`Freier Speicherplatz von „${dir}“ konnte nicht ermittelt werden.`)
  }
}

export async function defaultFetchStream(url: string): Promise<NodeJS.ReadableStream> {
  const res = await fetch(url, { headers: { 'User-Agent': 'tandem-updater' } })
  if (!res.ok || !res.body) throw new Error(`Download fehlgeschlagen: HTTP ${res.status}`)
  return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0])
}

/** Deletes every half-written download. Safe to call when there is none. */
export function removePartials(dir: string): void {
  for (const name of [EXE_NAME, NATIVE_NAME]) {
    fs.rmSync(path.join(dir, name + NEW_SUFFIX), { force: true })
  }
}

async function fetchAsset(
  asset: ReleaseAsset,
  deps: DownloadDeps,
  alreadyDone: number,
  total: number,
): Promise<number> {
  const target = path.join(deps.dir, asset.name + NEW_SUFFIX)
  const hash = crypto.createHash('sha256')
  let done = alreadyDone
  let lastReport = 0

  const source = await deps.fetchStream(asset.url)

  // Hashing happens inside the pipeline as a Transform, not via a parallel
  // 'data' listener on `source`. Attaching `.on('data', ...)` switches a
  // stream into flowing mode immediately, and whether `pipeline()`'s own
  // consumer gets wired up before the first chunk is emitted is a timing
  // detail of Node's stream internals, not a guarantee this code can lean
  // on -- if it lost that race, bytes would reach the hash but never the
  // file (or vice versa), and a truncated file could still pass its
  // checksum. Routing every byte through a Transform that both hashes and
  // forwards makes that race structurally impossible: there is only one
  // consumer, and hashing and writing happen on the same chunk in the same
  // step.
  const hasher = new Transform({
    transform(chunk: Buffer, _enc, callback) {
      hash.update(chunk)
      done += chunk.length
      // Throttled: a 114 MB file would otherwise push thousands of SSE frames
      // at every connected manifest.
      const now = Date.now()
      if (now - lastReport >= 500) {
        lastReport = now
        deps.onProgress(done, total)
      }
      callback(null, chunk)
    },
  })

  await pipeline(source, hasher, fs.createWriteStream(target))

  const got = hash.digest('hex')
  if (got !== asset.sha256) {
    throw new Error(
      `Prüfsumme von ${asset.name} stimmt nicht. Erwartet ${asset.sha256}, bekommen ${got}.`,
    )
  }
  deps.onProgress(done, total)
  return done
}

/**
 * Both files, or nothing. On any failure every partial file is removed, so the
 * install step can never find half a release lying around and install it.
 */
export async function downloadRelease(release: Release, deps: DownloadDeps): Promise<void> {
  const total = release.exe.size + release.native.size

  // Sweep before probing free space, not after: a prior run that was killed
  // mid-download (process killed, so the catch below never ran) can leave
  // .new files behind, and those must not survive into this attempt either
  // way. Doing it first also makes the check below more accurate -- stale
  // .new files are occupying exactly the space it is about to measure, so
  // removing them first means the check sees the space they were wasting.
  removePartials(deps.dir)

  const free = (deps.freeBytes ?? defaultFreeBytes)(deps.dir)
  // Twice over: the new files sit beside the old ones until the swap is done.
  if (free < total * 2) {
    throw new Error(
      `Zu wenig Speicherplatz: ${Math.round(total * 2 / 1e6)} MB nötig, ` +
        `${Math.round(free / 1e6)} MB frei.`,
    )
  }

  try {
    const afterExe = await fetchAsset(release.exe, deps, 0, total)
    await fetchAsset(release.native, deps, afterExe, total)
  } catch (err) {
    removePartials(deps.dir)
    throw err
  }
}
