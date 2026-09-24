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

// Windows refuses to delete the image of a running process. The rollback copy
// of the exe IS this process's image — it was renamed, not closed — so the
// cleanup after a healthy restart always fails with EPERM on the real machine.
// That must not turn a successful update into a rollback that kills the new
// version: the new process cleans up after this one has exited.
describe('installUpdate — the rollback copy is still locked by this process', () => {
  const lockOldExe = () => {
    const real = fs.rmSync
    return vi.spyOn(fs, 'rmSync').mockImplementation((p, opts) => {
      // Only once the swap is done: the stale-copy sweep before it deletes a
      // leftover from an earlier run, which no process holds.
      if (path.basename(String(p)) === OLD_EXE && !has('tandem.exe.new')) {
        throw Object.assign(new Error('EPERM, Permission denied'), { code: 'EPERM' })
      }
      return real(p, opts)
    })
  }

  it('still ends the old process with success and leaves the new files in place', async () => {
    stage()
    const d = deps()
    const spy = lockOldExe()
    try {
      await installUpdate(d)
    } finally {
      spy.mockRestore()
    }
    expect(d.exit).toHaveBeenCalledWith(0)
    expect(d.exit).not.toHaveBeenCalledWith(1)
    expect(read('tandem.exe')).toBe('neu')
    expect(read('better_sqlite3.node')).toBe('neu-node')
    expect(has(FAILURE_MARKER)).toBe(false)
  })

  it('does not kill the new version or start the old one again', async () => {
    stage()
    const kill = vi.fn()
    const d = deps({ spawnDetached: vi.fn().mockReturnValue({ kill }) })
    const spy = lockOldExe()
    try {
      await installUpdate(d)
    } finally {
      spy.mockRestore()
    }
    expect(kill).not.toHaveBeenCalled()
    expect(d.spawnDetached).toHaveBeenCalledTimes(1)
  })

  it('still removes the copies it can', async () => {
    stage()
    const spy = lockOldExe()
    try {
      await installUpdate(deps())
    } finally {
      spy.mockRestore()
    }
    expect(has(OLD_NATIVE)).toBe(false)
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

  // Says the installation was not touched, not that it was "restored" — nothing
  // had been renamed yet when closeServer() rejected.
  it('says the installation was not changed when closeServer rejects before any rename', async () => {
    stage()
    const d = deps({ closeServer: vi.fn().mockRejectedValue(new Error('close boom')) })
    await installUpdate(d)
    expect(takeFailureMarker(dir)).toMatch(/nichts verändert/)
  })

  // Pins as much of the EADDRINUSE-vs-dying-parent contract as this module can:
  // closeServer() rejecting can leave this process still holding the port (and
  // still answering health checks) for a moment, so the recovery spawn MUST
  // happen, and the spawned process is the only thing that can retry the bind —
  // this module has no way to wait for the port to free itself. What it CAN pin
  // is its own ordering: spawnDetached is actually called on this path, and
  // exit() — which kills this process and finally releases the port — comes
  // strictly after it, never before. Whether the spawned process actually wins
  // that race by retrying its bind instead of deferring to a "busy and healthy"
  // read is a property of spawnDetached's real implementation (a later task,
  // spawning the real tandem.exe), not something a call to a mocked function
  // here can exercise.
  it('calls spawnDetached before exit on the unexpected-throw recovery path', async () => {
    stage()
    const order: string[] = []
    const d = deps({
      closeServer: vi.fn().mockRejectedValue(new Error('close boom')),
      spawnDetached: vi.fn(() => { order.push('spawn'); return { kill: vi.fn() } }),
      exit: vi.fn(() => { order.push('exit') }),
    })
    await installUpdate(d)
    expect(order).toEqual(['spawn', 'exit'])
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
    // Unlike the closeServer-rejects case, the rename DID happen here (waitForHealth
    // rejects only after spawnDetached), so the marker must say a restore occurred.
    expect(takeFailureMarker(dir)).toMatch(/Unerwarteter Fehler.*wiederhergestellt/)
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

  // The restarted process retries until the old one has let go of its image.
  it('says whether everything is gone', () => {
    fs.writeFileSync(path.join(dir, OLD_EXE), 'alt')
    expect(cleanupLeftovers(dir)).toBe(true)

    fs.writeFileSync(path.join(dir, OLD_EXE), 'alt')
    const spy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    })
    try {
      expect(cleanupLeftovers(dir)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  it('does nothing on a folder that has never seen an update', () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'laufend')
    expect(() => cleanupLeftovers(dir)).not.toThrow()
    expect(has('tandem.exe')).toBe(true)
  })

  it('does not throw when a file cannot be removed, and still attempts the others', () => {
    fs.writeFileSync(path.join(dir, OLD_EXE), 'alt')
    fs.writeFileSync(path.join(dir, OLD_NATIVE), 'alt')
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'halb geladen')
    fs.writeFileSync(path.join(dir, 'better_sqlite3.node.new'), 'halb-node')

    const spy = vi.spyOn(fs, 'rmSync')
    spy.mockImplementationOnce(() => {
      throw new Error('EBUSY: file locked')
    })
    try {
      expect(() => cleanupLeftovers(dir)).not.toThrow()
    } finally {
      spy.mockRestore()
    }

    // The first file failed, but the rest should still be deleted (or attempted).
    // At least the successfully removed ones should be gone.
    const remaining = fs.readdirSync(dir)
    expect(remaining.length).toBeLessThan(4)
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

  it('does not throw when the marker file cannot be removed, but still returns the reason', () => {
    fs.writeFileSync(path.join(dir, FAILURE_MARKER), JSON.stringify({ reason: 'test reason' }))
    const spy = vi.spyOn(fs, 'rmSync')
    spy.mockImplementationOnce(() => {
      throw new Error('EBUSY: file locked')
    })
    try {
      expect(takeFailureMarker(dir)).toBe('test reason')
      expect(has(FAILURE_MARKER)).toBe(true) // file still exists because deletion failed
    } finally {
      spy.mockRestore()
    }
  })
})
