import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

// This file already covers the exported versionMismatch() function above.
// The tests below exercise the CLI entry point at the bottom of
// check-version-tag.mjs instead — that block used a hand-built file://
// comparison that is always false on Windows (import.meta.url gets a third
// slash that a naive `file://${argv[1]}` template literal never adds), so the
// guard silently never ran there even though every unit test stayed green.
// Running the real script as a subprocess is the only way to catch that.

const scriptSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'check-version-tag.mjs'),
  'utf8',
)

const dirsToClean: string[] = []

afterEach(() => {
  while (dirsToClean.length) {
    fs.rmSync(dirsToClean.pop() as string, { recursive: true, force: true })
  }
})

/**
 * Builds a throwaway git repo carrying a fresh copy of the real
 * check-version-tag.mjs (read from disk above, not a hand-maintained
 * duplicate that could drift) plus a package.json at the given version, tags
 * HEAD with `tag` unless it is null, and returns the repo directory.
 * `-c user.*` is passed on the commit itself so the test does not depend on
 * this machine's global git config.
 */
function fixtureRepo(pkgVersion: string, tag: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tandem-version-tag-'))
  dirsToClean.push(dir)

  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.writeFileSync(path.join(dir, 'scripts', 'check-version-tag.mjs'), scriptSource)
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture', version: pkgVersion }),
  )

  execFileSync('git', ['init', '--quiet'], { cwd: dir, stdio: 'pipe' })
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' })
  execFileSync(
    'git',
    [
      '-c', 'user.email=test@example.com',
      '-c', 'user.name=Test',
      '-c', 'commit.gpgsign=false',
      'commit', '--quiet', '-m', 'init',
    ],
    { cwd: dir, stdio: 'pipe' },
  )
  if (tag) execFileSync('git', ['tag', tag], { cwd: dir, stdio: 'pipe' })

  return dir
}

/** Runs the fixture's copy of the script as a real subprocess. */
function runGuard(dir: string): { status: number; stderr: string } {
  try {
    execFileSync('node', [path.join(dir, 'scripts', 'check-version-tag.mjs')], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stderr: '' }
  } catch (err) {
    const e = err as { status?: number; stderr?: Buffer | string }
    return { status: e.status ?? 1, stderr: e.stderr?.toString() ?? '' }
  }
}

describe('check-version-tag CLI', () => {
  it('exits 0 when the tag on HEAD matches package.json', () => {
    const dir = fixtureRepo('1.2.0', 'v1.2.0')
    expect(runGuard(dir).status).toBe(0)
  })

  it('exits non-zero and names both numbers when the tag disagrees', () => {
    const dir = fixtureRepo('1.1.0', 'v1.2.0')
    const result = runGuard(dir)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/1\.1\.0/)
    expect(result.stderr).toMatch(/1\.2\.0/)
  })

  it('exits 0 when HEAD carries no tag at all', () => {
    const dir = fixtureRepo('1.1.0', null)
    expect(runGuard(dir).status).toBe(0)
  })
})
