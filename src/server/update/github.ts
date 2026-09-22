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
 * how to rank -- returns null rather than throwing; see compareVersions.
 */
function toPart(part: string | undefined): number | null {
  // A part that is simply absent (the shorter of two dotted strings) is not
  // malformed, it is just shorter. "1.2" vs "1.2.0" is a legitimate way to
  // spell the same version, so a missing trailing part counts as zero.
  if (part === undefined) return 0
  if (!/^\d+$/.test(part)) return null
  return Number(part)
}

/**
 * Numeric comparison, part by part. Written out rather than pulled in: '10'
 * sorts before '9' as a string, and that is the only thing a version compare
 * has to get right here. Missing trailing parts count as zero; the parts are
 * compared out to the length of the longer operand, so a stray extra segment
 * (e.g. "1.2.0.5") is never silently dropped.
 *
 * Returns `null`, never throws, when either version has ANY part this
 * function cannot rank (a pre-release suffix, a non-numeric segment, ...) --
 * every part of both operands is validated up front, before any comparison
 * happens, so a malformed part is never missed just because a difference
 * turned up earlier in the string (e.g. compareVersions('1.3.0',
 * '1.2.0-beta') is null, not 1, even though '3' already differs from '2' at
 * index 1). `null` here means the same thing it does everywhere else in this
 * module -- "nothing here I would dare compare" -- and putting it in the
 * return type instead of a thrown error means the compiler, not a comment,
 * forces every caller to deal with it. That matters because a future caller
 * compares this against APP_VERSION, which is unvalidated input straight out
 * of package.json, and must treat an unparseable version as a failed check
 * rather than something that happens to compare as equal.
 */
export function compareVersions(a: string, b: string): number | null {
  const pa = a.split('.')
  const pb = b.split('.')
  const len = Math.max(pa.length, pb.length)
  const na: (number | null)[] = []
  const nb: (number | null)[] = []
  for (let i = 0; i < len; i++) {
    na.push(toPart(pa[i]))
    nb.push(toPart(pb[i]))
  }
  // Validate every part of both operands before comparing anything -- a
  // malformed part after the first difference must still refuse the whole
  // comparison, not get skipped because the loop below already returned.
  if (na.some((n) => n === null) || nb.some((n) => n === null)) return null
  for (let i = 0; i < len; i++) {
    const diff = (na[i] as number) - (nb[i] as number)
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
  // but a trust boundary is exactly the place to spend a few lines and
  // require the transport we actually expect instead of trusting the
  // payload. TLS is required for anything reachable over a network; plain
  // HTTP is allowed only on loopback, where the manual staging test
  // (build.md) points a real packaged exe at a fake release served by a
  // throwaway local server -- requiring TLS there would mean a self-signed
  // certificate that Node's `fetch` rejects anyway, so the test would just
  // never run. Loopback traffic never leaves the machine, so there is no
  // network transport there to downgrade.
  let downloadUrl: URL
  try {
    downloadUrl = new URL(a.browser_download_url)
  } catch {
    return null
  }
  // WHATWG URL keeps the brackets on an IPv6 host: `new URL('http://[::1]/x')
  // .hostname` is the literal string "[::1]", not "::1". Handle both forms
  // in case that ever changes across environments.
  const isLoopbackHost = downloadUrl.hostname === 'localhost'
    || downloadUrl.hostname === '127.0.0.1'
    || downloadUrl.hostname === '::1'
    || downloadUrl.hostname === '[::1]'
  const isSecure = downloadUrl.protocol === 'https:'
  const isLoopbackHttp = downloadUrl.protocol === 'http:' && isLoopbackHost
  if (!isSecure && !isLoopbackHttp) return null
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
