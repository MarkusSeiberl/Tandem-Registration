import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// APP_VERSION resolves __APP_VERSION__ only when esbuild's build-server.mjs
// substituted it; a plain vitest run never does that, so every import here
// exercises fromPackageJson()'s dev-mode fallback, which reads package.json
// from process.cwd() at module-load time. vi.resetModules() forces a fresh
// module instance per test so each chdir is actually picked up.
const originalCwd = process.cwd()
let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-version-'))
})

afterEach(() => {
  process.chdir(originalCwd)
  fs.rmSync(dir, { recursive: true, force: true })
})

async function loadAppVersion(): Promise<string> {
  process.chdir(dir)
  vi.resetModules()
  const mod = await import('../src/server/version')
  return mod.APP_VERSION
}

describe('APP_VERSION dev-mode fallback', () => {
  it('reads the version out of package.json when there is no bundled define', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '9.9.9' }))
    expect(await loadAppVersion()).toBe('9.9.9')
  })

  it('falls back to 0.0.0 when package.json is missing', async () => {
    // A dev run started from somewhere without a package.json — the version
    // only gates whether an update is offered, so this must not throw.
    expect(await loadAppVersion()).toBe('0.0.0')
  })

  it('falls back to 0.0.0 when package.json is not valid JSON', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), '{ not json')
    expect(await loadAppVersion()).toBe('0.0.0')
  })

  it('falls back to 0.0.0 when package.json has no version field', async () => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'no-version' }))
    expect(await loadAppVersion()).toBe('0.0.0')
  })
})
