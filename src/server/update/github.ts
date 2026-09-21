const GITHUB_LATEST =
  'https://api.github.com/repos/MarkusSeiberl/Tandem-Registration/releases/latest'

// Overridable so the manual staging test (build.md) can point a real packaged
// exe at a fake release on 127.0.0.1 — without editing this file and having to
// remember to change it back before a build goes out. Unset in every normal run.
export const RELEASE_URL = process.env.TANDEM_RELEASE_URL || GITHUB_LATEST

// The two files a release must carry. Exactly these names — copy-native-binary
// and build-exe produce them, and install.ts renames them in place.
export const EXE_NAME = 'tandem.exe'
export const NATIVE_NAME = 'better_sqlite3.node'

export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** Lowercase hex, 64 characters. The `sha256:` prefix is stripped here. */
  sha256: string
}

export interface Release {
  version: string
  notes: string
  exe: ReleaseAsset
  native: ReleaseAsset
}

export type Fetcher = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/**
 * A dotted-version part that is a plain non-negative integer, e.g. "0", "12".
 * Anything else ("0-beta", "x", "1e3") is not a version this program knows
 * how to rank.
 */
function toPart(part: string | undefined): number {
  // A part that is simply absent (the shorter of two dotted strings) is not
  // malformed, it is just shorter. "1.2" vs "1.2.0" is a legitimate way to
  // spell the same version, so a missing trailing part counts as zero.
  if (part === undefined) return 0
  if (!/^\d+$/.test(part)) {
    // We throw rather than coerce to 0, because `Number(n) || 0` used to
    // silently turn "1.2.0-beta" into "1.2.0" (equal!) and turn a build
    // metadata suffix into "no update available" with nobody the wiser.
    // A version this function cannot parse is a bug in whoever produced it
    // (package.json, a release tag) and must fail loudly, not quietly
    // compare as equal. Callers that feed this from an unvalidated source
    // (APP_VERSION out of package.json, in a later task) must catch this
    // themselves and log it; this function never runs at module load, so
    // throwing here cannot crash the server at startup by itself.
    throw new Error(`compareVersions: not a plain integer version part: "${part}"`)
  }
  return Number(part)
}

/**
 * Numeric comparison, part by part. Written out rather than pulled in: '10'
 * sorts before '9' as a string, and that is the only thing a version compare
 * has to get right here. Missing trailing parts count as zero; the parts are
 * compared out to the length of the longer operand, so a stray extra segment
 * (e.g. "1.2.0.5") is never silently dropped.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = toPart(pa[i]) - toPart(pb[i])
    if (diff !== 0) return diff
  }
  return 0
}

function asAsset(raw: unknown): ReleaseAsset | null {
  if (typeof raw !== 'object' || raw === null) return null
  const a = raw as Record<string, unknown>
  const digest = typeof a.digest === 'string' ? a.digest : ''
  if (!digest.startsWith('sha256:')) return null
  const sha256 = digest.slice('sha256:'.length).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null
  if (typeof a.name !== 'string') return null
  if (typeof a.browser_download_url !== 'string') return null
  // This URL gets fetched and the result executed in place of the running
  // program. `fetch` already refuses non-http(s) schemes and the URL comes
  // from GitHub's TLS-protected API, so this is not closing a live hole --
  // but a trust boundary is exactly the place to spend one cheap line and
  // require the scheme we actually expect instead of trusting the payload.
  if (!a.browser_download_url.startsWith('https://')) return null
  if (typeof a.size !== 'number' || a.size <= 0) return null
  return { name: a.name, url: a.browser_download_url, size: a.size, sha256 }
}

/**
 * Turns a GitHub release payload into something installable, or null.
 *
 * Null is not an error: it is "there is nothing here I would dare install".
 * Every caller treats it as "no update" and says nothing to the operator.
 */
export function parseRelease(payload: unknown): Release | null {
  if (typeof payload !== 'object' || payload === null) return null
  const p = payload as Record<string, unknown>
  const tag = typeof p.tag_name === 'string' ? p.tag_name : ''
  const version = tag.startsWith('v') ? tag.slice(1) : tag
  if (!/^\d+\.\d+(\.\d+)?$/.test(version)) return null

  const assets = Array.isArray(p.assets) ? p.assets.map(asAsset) : []
  const exe = assets.find((a) => a?.name === EXE_NAME) ?? null
  const native = assets.find((a) => a?.name === NATIVE_NAME) ?? null
  // Both or nothing — see the ABI note in the design doc.
  if (!exe || !native) return null

  return { version, notes: typeof p.body === 'string' ? p.body : '', exe, native }
}

/**
 * The one network call this program makes. Unauthenticated (60/h per IP; we
 * use 24/day), 5 s, no retry: a drop zone without internet must not wait.
 */
export async function fetchLatestRelease(fetcher?: Fetcher): Promise<Release | null> {
  const get: Fetcher =
    fetcher ??
    ((url) =>
      fetch(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'tandem-updater',
        },
        signal: AbortSignal.timeout(5000),
      }))
  let payload: unknown
  try {
    const res = await get(RELEASE_URL)
    if (!res.ok) {
      console.error(`[tandem] Update-Abfrage: HTTP ${res.status}`)
      return null
    }
    payload = await res.json()
  } catch (err) {
    // No internet, DNS down, timeout, a body that isn't even JSON: all of
    // this is the normal state of a landing site, not a bug. Silent null.
    console.error('[tandem] Update-Abfrage fehlgeschlagen:', err)
    return null
  }

  // Parsing is deliberately outside the transport try/catch above. A throw
  // here is our own code being wrong, not the network being down, and must
  // not be reported the same way -- "no internet" would hide a real bug
  // behind a message operators are trained to ignore. It still resolves to
  // null either way: an update-checker must never crash the program that is
  // asking it whether an update exists.
  try {
    return parseRelease(payload)
  } catch (err) {
    console.error('[tandem] Update-Antwort konnte nicht verarbeitet werden (Programmfehler):', err)
    return null
  }
}
