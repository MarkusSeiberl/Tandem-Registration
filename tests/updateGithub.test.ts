import { describe, it, expect, vi } from 'vitest'
import {
  compareVersions, parseRelease, fetchLatestRelease, RELEASE_URL,
} from '../src/server/update/github'

/** A release payload shaped exactly like the real one (see `gh release view v1.1.0 --json`). */
function payload(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v1.2.0',
    body: '## Kassieren\n\nMehrere Tandems auf einmal.',
    assets: [
      {
        name: 'tandem.exe', size: 114510588,
        browser_download_url: 'https://example.invalid/tandem.exe',
        digest: 'sha256:1b6e3732e2c80894acaec2fc9661684b1f5f72bc6c73093978d8c225667ef783',
      },
      {
        name: 'better_sqlite3.node', size: 1919488,
        browser_download_url: 'https://example.invalid/better_sqlite3.node',
        digest: 'sha256:e75b8c024a85179d8e0e51203a8b8867916e9a51327ce3953db5f8483cc9a91e',
      },
    ],
    ...overrides,
  }
}

describe('compareVersions', () => {
  it('orders by number, not by string', () => {
    // '10' < '9' as a string. This is why there is a function at all.
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
  })

  it('reports equal versions as equal', () => {
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
  })

  it('treats a missing part as zero', () => {
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })

  // These four are all measured bugs in the naive `Number(n) || 0` version:
  // every one of them used to come back 0 (equal), which for the update
  // checker means "no update available" -- silently, and for the wrong
  // reason each time. compareVersions now answers `null` for each rather
  // than throwing, but the point stands: none of them may compare as equal.
  it('refuses a pre-release suffix instead of treating it as equal', () => {
    expect(compareVersions('1.2.0-beta', '1.2.0')).toBeNull()
  })

  it('refuses a pre-release suffix on either operand', () => {
    expect(compareVersions('1.2.0', '1.2.0-beta')).toBeNull()
  })

  it('does not silently drop a fourth version segment', () => {
    expect(compareVersions('1.2.0.5', '1.2.0')).toBeGreaterThan(0)
  })

  it('refuses a non-numeric segment instead of treating it as equal', () => {
    expect(compareVersions('1.2.x', '1.2.0')).toBeNull()
  })

  // Regression: compareVersions used to return on the first numeric
  // difference without ever looking at a malformed part sitting after it,
  // so a difference earlier in the string could mask an unrankable operand.
  // All parts of both operands must now be validated before anything is
  // compared, regardless of where they sit.
  it('refuses a malformed part even when an earlier part already differs', () => {
    expect(compareVersions('1.3.0', '1.2.0-beta')).toBeNull()
  })

  it('still refuses when the malformed part comes first', () => {
    expect(compareVersions('1.2.0', '1.2.0-beta')).toBeNull()
  })

  it('refuses a malformed part on the other operand even when an earlier part already differs', () => {
    expect(compareVersions('2.0.0', '1.x.0')).toBeNull()
  })
})

describe('parseRelease', () => {
  it('reads version, notes and both assets', () => {
    const release = parseRelease(payload())
    expect(release).not.toBeNull()
    expect(release!.version).toBe('1.2.0')
    expect(release!.notes).toContain('Kassieren')
    expect(release!.exe.size).toBe(114510588)
    expect(release!.native.url).toBe('https://example.invalid/better_sqlite3.node')
    expect(release!.exe.sha256).toHaveLength(64)
  })

  // The exe and the .node must come from the same build: the native binary is
  // compiled against the build machine's Node ABI, and the exe embeds that same
  // Node. A release carrying only one of them is not installable.
  it('refuses a release without the native binary', () => {
    const assets = payload().assets.filter((a) => a.name === 'tandem.exe')
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  // Split by asset rather than blanking both digests at once: `.map(asAsset)`
  // validates each asset uniformly today, but a test that breaks both assets
  // together would not notice a bug that checked only one of them.
  it('refuses a release whose exe asset has no sha256 digest', () => {
    const assets = payload().assets.map((a) => (
      a.name === 'tandem.exe' ? { ...a, digest: null } : a
    ))
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  it('refuses a release whose native asset has no sha256 digest', () => {
    const assets = payload().assets.map((a) => (
      a.name === 'better_sqlite3.node' ? { ...a, digest: null } : a
    ))
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  // Real assets come from GitHub's TLS-protected API, so https is required
  // for anything reachable over the network.
  it('refuses an asset whose download URL is http on a public host', () => {
    const assets = payload().assets.map((a) => (
      a.name === 'tandem.exe'
        ? { ...a, browser_download_url: 'http://example.invalid/tandem.exe' }
        : a
    ))
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  // The manual staging test (build.md) serves a fake release over plain HTTP
  // on loopback, because a TLS requirement there would mean a self-signed
  // certificate that Node's `fetch` rejects anyway -- the test would simply
  // never run. Loopback never touches the network, so there is nothing to
  // downgrade.
  it('accepts an asset whose download URL is http on 127.0.0.1', () => {
    const assets = payload().assets.map((a) => (
      a.name === 'tandem.exe'
        ? { ...a, browser_download_url: 'http://127.0.0.1:8099/tandem.exe' }
        : a
    ))
    expect(parseRelease(payload({ assets }))).not.toBeNull()
  })

  it('accepts an asset whose download URL is http on localhost', () => {
    const assets = payload().assets.map((a) => (
      a.name === 'tandem.exe'
        ? { ...a, browser_download_url: 'http://localhost:8099/tandem.exe' }
        : a
    ))
    expect(parseRelease(payload({ assets }))).not.toBeNull()
  })

  // `new URL('http://[::1]:8099/x').hostname` is the literal string "[::1]"
  // (brackets included), not "::1" -- this pins the form this module has to
  // handle.
  it('accepts an asset whose download URL is http on IPv6 loopback', () => {
    expect(new URL('http://[::1]:8099/x').hostname).toBe('[::1]')
    const assets = payload().assets.map((a) => (
      a.name === 'tandem.exe'
        ? { ...a, browser_download_url: 'http://[::1]:8099/tandem.exe' }
        : a
    ))
    expect(parseRelease(payload({ assets }))).not.toBeNull()
  })

  it('refuses an asset whose download URL does not parse at all', () => {
    const assets = payload().assets.map((a) => (
      a.name === 'tandem.exe'
        ? { ...a, browser_download_url: 'not a url' }
        : a
    ))
    expect(parseRelease(payload({ assets }))).toBeNull()
  })

  it('refuses a tag that is not a version', () => {
    expect(parseRelease(payload({ tag_name: 'nightly' }))).toBeNull()
  })

  it('refuses anything that is not a release object', () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease('boom')).toBeNull()
  })
})

describe('RELEASE_URL', () => {
  it('is GitHub by default', () => {
    expect(RELEASE_URL).toContain('api.github.com')
  })

  // The manual staging test (build.md) points a real packaged exe at a fake
  // release on 127.0.0.1. Without this it would have to edit the source and
  // remember to change it back before the next build.
  it('can be pointed elsewhere for the staging test', async () => {
    vi.stubEnv('TANDEM_RELEASE_URL', 'http://127.0.0.1:8099/latest')
    vi.resetModules()
    const fresh = await import('../src/server/update/github')
    expect(fresh.RELEASE_URL).toBe('http://127.0.0.1:8099/latest')
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('fetchLatestRelease', () => {
  it('asks GitHub for the latest release', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => payload(),
    })
    const release = await fetchLatestRelease(fetcher)
    expect(fetcher).toHaveBeenCalledWith(RELEASE_URL)
    expect(release!.version).toBe('1.2.0')
  })

  // A landing site without internet is the normal case, not the failure case.
  it('answers null when the network is gone', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))
    await expect(fetchLatestRelease(fetcher)).resolves.toBeNull()
  })

  it('answers null on a rate limit', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: async () => ({}),
    })
    await expect(fetchLatestRelease(fetcher)).resolves.toBeNull()
  })

  // A payload whose `assets` getter throws stands in for a future bug inside
  // parseRelease: something in our own code breaking while reading the
  // response, as opposed to the network never answering at all. Both must
  // resolve to null (an update-checker must never crash the caller), but the
  // log line must say which one happened -- "no internet" must not be the
  // cover story for a parsing bug.
  it('reports a parsing failure differently from a transport failure', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const brokenPayload = {
      tag_name: 'v1.2.0',
      body: '',
      get assets(): unknown[] {
        throw new Error('boom: parseRelease bug')
      },
    }
    const fetcher = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => brokenPayload,
    })

    await expect(fetchLatestRelease(fetcher)).resolves.toBeNull()

    expect(errorSpy).toHaveBeenCalledTimes(1)
    const [message] = errorSpy.mock.calls[0]
    expect(message).toContain('Programmfehler')
    expect(message).not.toContain('Update-Abfrage fehlgeschlagen')

    errorSpy.mockRestore()
  })
})
