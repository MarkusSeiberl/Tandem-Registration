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
 * Numeric comparison over three parts. Written out rather than pulled in: '10'
 * sorts before '9' as a string, and that is the only thing a version compare
 * has to get right here. Missing parts count as zero.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
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
  try {
    const res = await get(RELEASE_URL)
    if (!res.ok) {
      console.error(`[tandem] Update-Abfrage: HTTP ${res.status}`)
      return null
    }
    return parseRelease(await res.json())
  } catch (err) {
    console.error('[tandem] Update-Abfrage fehlgeschlagen:', err)
    return null
  }
}
