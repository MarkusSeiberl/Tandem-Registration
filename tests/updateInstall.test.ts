import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  installUpdate, cleanupLeftovers, takeFailureMarker, OLD_EXE, OLD_NATIVE, FAILURE_MARKER,
} from '../src/server/update/install'

let dir: string

/** An install folder as it looks the moment the operator presses install. */
function stage() {
  fs.writeFileSync(path.join(dir, 'tandem.exe'), 'alt')
  fs.writeFileSync(path.join(dir, 'better_sqlite3.node'), 'alt-node')
  fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'neu')
  fs.writeFileSync(path.join(dir, 'better_sqlite3.node.new'), 'neu-node')
  fs.writeFileSync(path.join(dir, 'tandem.db'), 'der Sprungtag')
}

const deps = (over: Partial<Parameters<typeof installUpdate>[0]> = {}) => ({
  dir,
  closeServer: vi.fn().mockResolvedValue(undefined),
  spawnDetached: vi.fn().mockReturnValue({ kill: vi.fn() }),
  waitForHealth: vi.fn().mockResolvedValue(true),
  exit: vi.fn(),
  ...over,
})

const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8')
const has = (name: string) => fs.existsSync(path.join(dir, name))

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-inst-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('installUpdate — the happy path', () => {
  it('puts both new files in place and ends the old process', async () => {
    stage()
    const d = deps()
    await installUpdate(d)
    expect(read('tandem.exe')).toBe('neu')
    expect(read('better_sqlite3.node')).toBe('neu-node')
    expect(d.exit).toHaveBeenCalledWith(0)
  })

  it('closes the server before it renames anything', async () => {
    stage()
    const order: string[] = []
    const d = deps({
      closeServer: vi.fn(async () => { order.push('close') }),
      spawnDetached: vi.fn(() => { order.push('spawn'); return { kill: vi.fn() } }),
    })
    await installUpdate(d)
    expect(order).toEqual(['close', 'spawn'])
  })

  it('removes the rollback copies once the new version answers', async () => {
    stage()
    await installUpdate(deps())
    expect(has(OLD_EXE)).toBe(false)
    expect(has(OLD_NATIVE)).toBe(false)
  })

  it('leaves the database alone', async () => {
    stage()
    await installUpdate(deps())
    expect(read('tandem.db')).toBe('der Sprungtag')
  })

  // A leftover from an earlier, half-finished update would make the rename fail.
  it('clears a stale rollback copy before renaming', async () => {
    stage()
    fs.writeFileSync(path.join(dir, OLD_EXE), 'uralt')
    fs.writeFileSync(path.join(dir, OLD_NATIVE), 'uralt')
    await installUpdate(deps())
    expect(read('tandem.exe')).toBe('neu')
  })
})

describe('installUpdate — the new version does not come up', () => {
  it('puts both old files back and starts the old exe again', async () => {
    stage()
    const kill = vi.fn()
    const d = deps({
      waitForHealth: vi.fn().mockResolvedValue(false),
      spawnDetached: vi.fn().mockReturnValue({ kill }),
    })
    await installUpdate(d)
    expect(kill).toHaveBeenCalledTimes(1)
    expect(read('tandem.exe')).toBe('alt')
    expect(read('better_sqlite3.node')).toBe('alt-node')
    // Twice: once for the new version, once for the restored old one.
    expect(d.spawnDetached).toHaveBeenCalledTimes(2)
    expect(d.exit).toHaveBeenCalledWith(1)
  })

  it('leaves a reason behind for the restarted old version to show', async () => {
    stage()
    await installUpdate(deps({ waitForHealth: vi.fn().mockResolvedValue(false) }))
    expect(takeFailureMarker(dir)).toMatch(/nicht gestartet/)
  })

  it('refuses to start at all when a downloaded file is missing', async () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'alt')
    fs.writeFileSync(path.join(dir, 'better_sqlite3.node'), 'alt-node')
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'neu')
    const d = deps()
    await expect(installUpdate(d)).rejects.toThrow(/better_sqlite3\.node\.new/)
    expect(read('tandem.exe')).toBe('alt')
    expect(d.closeServer).not.toHaveBeenCalled()
  })
})

describe('installUpdate — an unexpected throw after the server is closed', () => {
  // fs.rmSync is not part of InstallDeps, so the only honest way to force the
  // stale-.old sweep to fail is to make the real fs.rmSync throw for that one
  // call. Spying on it directly (rather than e.g. turning OLD_EXE into a
  // directory) avoids leaving disk state that would itself corrupt the very
  // files this test checks were restored.
  it('recovers when the stale-.old sweep throws', async () => {
    stage()
    const spy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw new Error('Sweep boom')
    })
    const d = deps()
    try {
      await installUpdate(d)
    } finally {
      spy.mockRestore()
    }
    expect(read('tandem.exe')).toBe('alt')
    expect(read('better_sqlite3.node')).toBe('alt-node')
    expect(takeFailureMarker(dir)).toMatch(/Unerwarteter Fehler/)
    expect(d.spawnDetached).toHaveBeenCalled()
    expect(d.exit).toHaveBeenCalledWith(1)
  })

  it('recovers when spawnDetached throws on the way up', async () => {
    stage()
    const spawnDetached = vi.fn()
      .mockImplementationOnce(() => { throw new Error('spawn boom') })
      .mockReturnValue({ kill: vi.fn() })
    const d = deps({ spawnDetached })
    await installUpdate(d)
    expect(read('tandem.exe')).toBe('alt')
    expect(read('better_sqlite3.node')).toBe('alt-node')
    expect(takeFailureMarker(dir)).toMatch(/Unerwarteter Fehler/)
    expect(spawnDetached).toHaveBeenCalledTimes(2)
    expect(d.exit).toHaveBeenCalledWith(1)
  })

  // closeServer is documented as a compound teardown (Bonjour, Fastify, database).
  // If it rejects — say the database close fails after the HTTP listener is
  // already down — the call must still land in the same catch-all recovery as
  // every other unexpected throw, not escape before the guarded region starts.
  it('recovers when closeServer rejects', async () => {
    stage()
    const d = deps({ closeServer: vi.fn().mockRejectedValue(new Error('close boom')) })
    await installUpdate(d)
    // Nothing was renamed: the rejection happened before the rename block ever ran.
    expect(read('tandem.exe')).toBe('alt')
    expect(read('better_sqlite3.node')).toBe('alt-node')
    expect(takeFailureMarker(dir)).toMatch(/Unerwarteter Fehler/)
    expect(d.spawnDetached).toHaveBeenCalled()
    expect(d.exit).toHaveBeenCalledWith(1)
  })

  it('recovers when waitForHealth rejects instead of resolving false', async () => {
    stage()
    const kill = vi.fn()
    const d = deps({
      spawnDetached: vi.fn().mockReturnValue({ kill }),
      waitForHealth: vi.fn().mockRejectedValue(new Error('health boom')),
    })
    await installUpdate(d)
    expect(read('tandem.exe')).toBe('alt')
    expect(read('better_sqlite3.node')).toBe('alt-node')
    expect(takeFailureMarker(dir)).toMatch(/Unerwarteter Fehler/)
    expect(kill).toHaveBeenCalledTimes(1)
    // Once for the unhealthy new version, once for the restored old one.
    expect(d.spawnDetached).toHaveBeenCalledTimes(2)
    expect(d.exit).toHaveBeenCalledWith(1)
  })
})

describe('cleanupLeftovers', () => {
  it('deletes rollback copies — this process running proves the new version starts', () => {
    fs.writeFileSync(path.join(dir, OLD_EXE), 'alt')
    fs.writeFileSync(path.join(dir, OLD_NATIVE), 'alt')
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'halb geladen')
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'laufend')
    cleanupLeftovers(dir)
    expect(fs.readdirSync(dir)).toEqual(['tandem.exe'])
  })

  it('does nothing on a folder that has never seen an update', () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'laufend')
    expect(() => cleanupLeftovers(dir)).not.toThrow()
    expect(has('tandem.exe')).toBe(true)
  })
})

describe('takeFailureMarker', () => {
  it('reads the reason once and removes the file', () => {
    fs.writeFileSync(path.join(dir, FAILURE_MARKER), JSON.stringify({ reason: 'kaputt' }))
    expect(takeFailureMarker(dir)).toBe('kaputt')
    expect(has(FAILURE_MARKER)).toBe(false)
    expect(takeFailureMarker(dir)).toBeNull()
  })

  it('survives a marker file somebody mangled', () => {
    fs.writeFileSync(path.join(dir, FAILURE_MARKER), 'kein JSON')
    expect(takeFailureMarker(dir)).toBeNull()
    expect(has(FAILURE_MARKER)).toBe(false)
  })
})
