import { describe, it, expect } from 'vitest'
import { waitUntilWritable } from '../scripts/wait-writable.mjs'

const locked = (code = 'EBUSY') => Object.assign(new Error(code), { code })

/** A clock that only moves when the code under test sleeps. */
function fakeTime() {
  let t = 0
  return { now: () => t, sleep: async (ms: number) => { t += ms } }
}

describe('waitUntilWritable', () => {
  it('returns at once when the file is free', async () => {
    let calls = 0
    await waitUntilWritable('x', { ...fakeTime(), open: () => { calls++ } })
    expect(calls).toBe(1)
  })

  // Defender holds the fresh exe for a few seconds after pkg writes it.
  it('waits out a lock that clears', async () => {
    let calls = 0
    const open = () => { if (++calls < 4) throw locked() }
    await waitUntilWritable('x', { ...fakeTime(), open })
    expect(calls).toBe(4)
  })

  it('treats EPERM and EACCES as a lock too', async () => {
    const codes = ['EPERM', 'EACCES']
    const open = () => { const c = codes.shift(); if (c) throw locked(c) }
    await expect(waitUntilWritable('x', { ...fakeTime(), open })).resolves.toBeUndefined()
  })

  it('gives up with a readable error once the time is up', async () => {
    const open = () => { throw locked() }
    await expect(
      waitUntilWritable('dist/tandem.exe', { ...fakeTime(), open, timeoutMs: 2000 }),
    ).rejects.toThrow(/still locked after 2 s \(EBUSY\)/)
  })

  // A missing exe means pkg failed; waiting would only hide that.
  it('does not wait on an error that is not a lock', async () => {
    let calls = 0
    const open = () => { calls++; throw locked('ENOENT') }
    await expect(waitUntilWritable('x', { ...fakeTime(), open })).rejects.toThrow('ENOENT')
    expect(calls).toBe(1)
  })
})
