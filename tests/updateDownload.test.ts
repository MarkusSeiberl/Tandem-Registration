import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { Readable } from 'stream'
import { downloadRelease, removePartials } from '../src/server/update/download'
import type { Release } from '../src/server/update/github'

const EXE_BODY = Buffer.from('ich bin ein exe')
const NATIVE_BODY = Buffer.from('ich bin ein native binary')

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')

function release(overrides: Partial<Release> = {}): Release {
  return {
    version: '1.2.0',
    notes: '',
    exe: {
      name: 'tandem.exe', url: 'https://example.invalid/tandem.exe',
      size: EXE_BODY.length, sha256: sha(EXE_BODY),
    },
    native: {
      name: 'better_sqlite3.node', url: 'https://example.invalid/better_sqlite3.node',
      size: NATIVE_BODY.length, sha256: sha(NATIVE_BODY),
    },
    ...overrides,
  }
}

const bodies: Record<string, Buffer> = {
  'https://example.invalid/tandem.exe': EXE_BODY,
  'https://example.invalid/better_sqlite3.node': NATIVE_BODY,
}

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-dl-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

const deps = (over: Partial<Parameters<typeof downloadRelease>[1]> = {}) => ({
  dir,
  fetchStream: async (url: string) => Readable.from([bodies[url]]),
  onProgress: vi.fn(),
  freeBytes: () => 1_000_000_000,
  ...over,
})

describe('downloadRelease', () => {
  it('writes both files with a .new suffix', async () => {
    await downloadRelease(release(), deps())
    expect(fs.readFileSync(path.join(dir, 'tandem.exe.new'))).toEqual(EXE_BODY)
    expect(fs.readFileSync(path.join(dir, 'better_sqlite3.node.new'))).toEqual(NATIVE_BODY)
  })

  it('never touches the files that are in use', async () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe'), 'die laufende Version')
    await downloadRelease(release(), deps())
    expect(fs.readFileSync(path.join(dir, 'tandem.exe'), 'utf8')).toBe('die laufende Version')
  })

  it('reports progress across both files together', async () => {
    const onProgress = vi.fn()
    await downloadRelease(release(), deps({ onProgress }))
    const last = onProgress.mock.calls.at(-1)!
    expect(last[0]).toBe(EXE_BODY.length + NATIVE_BODY.length)
    expect(last[1]).toBe(EXE_BODY.length + NATIVE_BODY.length)
  })

  // The one check that stands between the internet and an exe that gets started.
  it('throws and leaves nothing behind when a checksum does not match', async () => {
    const bad = release({
      exe: { ...release().exe, sha256: 'f'.repeat(64) },
    })
    await expect(downloadRelease(bad, deps())).rejects.toThrow(/Prüfsumme/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('refuses to start when the disk is nearly full', async () => {
    await expect(downloadRelease(release(), deps({ freeBytes: () => 10 })))
      .rejects.toThrow(/Speicherplatz/)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('leaves nothing behind when the connection drops mid-file', async () => {
    const fetchStream = async () =>
      Readable.from((async function* () {
        yield Buffer.from('halb')
        throw new Error('ECONNRESET')
      })())
    await expect(downloadRelease(release(), deps({ fetchStream }))).rejects.toThrow()
    expect(fs.readdirSync(dir)).toEqual([])
  })

  // The exe (fetched first) is not the only file this has to hold for: a
  // good exe download must still be discarded when the native binary that
  // comes after it fails, or the install step could find a lone tandem.exe.new
  // left over from a prior, half-completed release.
  it('leaves nothing behind when the second file fails after the first succeeded', async () => {
    const bad = release({
      native: { ...release().native, sha256: 'f'.repeat(64) },
    })
    await expect(downloadRelease(bad, deps())).rejects.toThrow(/Prüfsumme/)
    expect(fs.readdirSync(dir)).toEqual([])
  })
})

describe('removePartials', () => {
  it('deletes leftover .new files and nothing else', () => {
    fs.writeFileSync(path.join(dir, 'tandem.exe.new'), 'x')
    fs.writeFileSync(path.join(dir, 'better_sqlite3.node.new'), 'x')
    fs.writeFileSync(path.join(dir, 'tandem.db'), 'wichtig')
    removePartials(dir)
    expect(fs.readdirSync(dir)).toEqual(['tandem.db'])
  })

  it('does nothing when there is nothing to clean up', () => {
    expect(() => removePartials(dir)).not.toThrow()
  })
})
