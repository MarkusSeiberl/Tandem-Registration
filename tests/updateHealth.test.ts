import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import path from 'path'
import { pathToFileURL } from 'url'
import { waitForHealth } from '../src/server/update/health'

describe('waitForHealth', () => {
  it('answers true as soon as the probe does', async () => {
    let calls = 0
    const probe = async () => ++calls >= 2
    expect(await waitForHealth(probe, 5000, 10)).toBe(true)
    expect(calls).toBe(2)
  })

  it('answers false once the time is up', async () => {
    expect(await waitForHealth(async () => false, 50, 10)).toBe(false)
  })

  // installUpdate waits here with the server, Bonjour and the database already
  // closed and the child unref'd. If the wait's own timers do not hold the
  // event loop open, Node exits mid-wait: no verdict, no rollback. A separate
  // process with nothing else open is the only honest way to see that.
  it('keeps an otherwise idle process alive until it has a verdict', () => {
    const mod = pathToFileURL(path.join(__dirname, '../src/server/update/health.ts')).href
    const script =
      `const { waitForHealth } = await import(${JSON.stringify(mod)});` +
      `const ok = await waitForHealth(async () => false, 300, 50);` +
      `process.stdout.write('verdict:' + ok);`
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      { encoding: 'utf8', cwd: path.join(__dirname, '..') },
    )
    expect(out).toBe('verdict:false')
  })
})
