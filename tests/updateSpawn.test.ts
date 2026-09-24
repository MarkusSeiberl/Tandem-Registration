import { describe, expect, it } from 'vitest'
import { restartEnv } from '../src/server/update/spawn'

describe('restartEnv', () => {
  it('marks the child as a replacement', () => {
    expect(restartEnv({}).TANDEM_RESTART).toBe('1')
  })

  // pkg only fills PKG_EXECPATH in when it is undefined; filled in with the
  // exe's own path, the new tandem.exe would start as bare `node` and die.
  it('pins PKG_EXECPATH to a defined value that never names an exe', () => {
    expect(restartEnv({}).PKG_EXECPATH).toBe('')
    expect(restartEnv({ PKG_EXECPATH: 'C:\\Tandem\\tandem.exe' }).PKG_EXECPATH).toBe('')
  })

  it('keeps everything else the operator started Tandem with', () => {
    const env = restartEnv({ PORT: '8080', TANDEM_RELEASE_URL: 'http://x' })
    expect(env.PORT).toBe('8080')
    expect(env.TANDEM_RELEASE_URL).toBe('http://x')
  })
})
