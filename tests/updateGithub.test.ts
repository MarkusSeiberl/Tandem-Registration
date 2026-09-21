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

  it('refuses an asset without a sha256 digest', () => {
    const assets = payload().assets.map((a) => ({ ...a, digest: null }))
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
})
