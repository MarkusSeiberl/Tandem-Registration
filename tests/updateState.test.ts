import { describe, it, expect, vi } from 'vitest'
import { UpdateState } from '../src/server/update/state'
import type { Release } from '../src/server/update/github'

const release = (version: string): Release => ({
  version,
  notes: '## Neu\n\nEtwas.',
  exe: { name: 'tandem.exe', url: 'u', size: 10, sha256: 'a'.repeat(64) },
  native: { name: 'better_sqlite3.node', url: 'u', size: 2, sha256: 'b'.repeat(64) },
})

describe('UpdateState', () => {
  it('starts idle and knows its own version', () => {
    const state = new UpdateState('1.1.0')
    expect(state.get().phase).toBe('idle')
    expect(state.get().currentVersion).toBe('1.1.0')
    expect(state.promptPending).toBe(false)
  })

  it('reports a newer release as available, with notes', () => {
    const state = new UpdateState('1.1.0')
    state.beginCheck()
    expect(state.get().phase).toBe('checking')
    state.foundRelease(release('1.2.0'), true)
    expect(state.get().phase).toBe('available')
    expect(state.get().latestVersion).toBe('1.2.0')
    expect(state.get().notes).toContain('Neu')
    expect(state.get().checkedAt).not.toBeNull()
  })

  it('reports the same version as up to date and keeps no release', () => {
    const state = new UpdateState('1.2.0')
    state.beginCheck()
    state.foundRelease(release('1.2.0'), true)
    expect(state.get().phase).toBe('up-to-date')
    expect(state.release).toBeNull()
  })

  it('never offers a downgrade', () => {
    const state = new UpdateState('2.0.0')
    state.beginCheck()
    state.foundRelease(release('1.9.9'), true)
    expect(state.get().phase).toBe('up-to-date')
  })

  it('reports a failed query without an error text on the screen', () => {
    const state = new UpdateState('1.1.0')
    state.beginCheck()
    state.foundRelease(null, true)
    expect(state.get().phase).toBe('check-failed')
    expect(state.get().error).toBeNull()
  })

  // The single rule only this class knows.
  it('arms the dialog on the startup check only', () => {
    const startup = new UpdateState('1.1.0')
    startup.beginCheck()
    startup.foundRelease(release('1.2.0'), true)
    expect(startup.promptPending).toBe(true)

    const hourly = new UpdateState('1.1.0')
    hourly.beginCheck()
    hourly.foundRelease(release('1.2.0'), false)
    expect(hourly.promptPending).toBe(false)
    expect(hourly.get().phase).toBe('available')
  })

  it('disarms the dialog once it has been shown', () => {
    const state = new UpdateState('1.1.0')
    state.beginCheck()
    state.foundRelease(release('1.2.0'), true)
    state.markPromptSeen()
    expect(state.promptPending).toBe(false)
  })

  it('tells its listeners on every change', () => {
    const state = new UpdateState('1.1.0')
    const seen = vi.fn()
    state.onChange(seen)
    state.beginCheck()
    state.patch({ phase: 'downloading', downloadedBytes: 5, totalBytes: 10 })
    expect(seen).toHaveBeenCalledTimes(2)
    expect(seen.mock.calls[1][0].downloadedBytes).toBe(5)
  })

  it('carries a failure message for the screen', () => {
    const state = new UpdateState('1.1.0')
    state.fail('download-failed', 'Prüfsumme stimmt nicht.')
    expect(state.get().phase).toBe('download-failed')
    expect(state.get().error).toBe('Prüfsumme stimmt nicht.')
  })

  it('stays disabled when built that way', () => {
    const state = new UpdateState('1.1.0', 'disabled')
    expect(state.get().phase).toBe('disabled')
  })

  // compareVersions answers null for a version part it cannot parse, and
  // APP_VERSION comes out of package.json unvalidated. A build mistake must not
  // take the jump day down, and must not leave the state stuck in 'checking' —
  // the sidebar entry and the dialog both wait on a resolved phase.
  it('survives an unparsable local version', () => {
    const state = new UpdateState('1.2.0-beta')
    state.beginCheck()
    expect(() => state.foundRelease(release('1.3.0'), true)).not.toThrow()
    expect(state.get().phase).toBe('check-failed')
    expect(state.promptPending).toBe(false)
    expect(state.release).toBeNull()
  })
})
