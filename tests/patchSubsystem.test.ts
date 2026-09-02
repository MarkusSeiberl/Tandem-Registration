import { describe, it, expect } from 'vitest'
// @ts-expect-error - build script, plain .mjs without type declarations
import { patchToGui, subsystemOffset } from '../scripts/patch-subsystem.mjs'

// A minimal but structurally real PE64 header: DOS stub with e_lfanew, the
// "PE\0\0" signature, COFF header, and an optional header whose Subsystem
// field sits 68 bytes in. Everything else is zero — the patcher only ever
// looks at these fields.
function fakePE(subsystem: number, peOffset = 0x80): Buffer {
  const buf = Buffer.alloc(peOffset + 256)
  buf.write('MZ', 0, 'ascii')
  buf.writeUInt32LE(peOffset, 0x3c)
  buf.writeUInt32LE(0x00004550, peOffset) // "PE\0\0"
  buf.writeUInt16LE(0x020b, peOffset + 24) // optional header magic: PE32+
  buf.writeUInt16LE(subsystem, peOffset + 92)
  return buf
}

describe('patch-subsystem', () => {
  it('locates the subsystem field behind the DOS and COFF headers', () => {
    expect(subsystemOffset(fakePE(3, 0x100))).toBe(0x100 + 92)
  })

  it('rewrites a console binary to GUI and reports what it replaced', () => {
    const buf = fakePE(3)
    expect(patchToGui(buf)).toBe(3)
    expect(buf.readUInt16LE(0x80 + 92)).toBe(2)
  })

  it('is idempotent: patching an already-GUI binary reports GUI and changes nothing', () => {
    const buf = fakePE(2)
    expect(patchToGui(buf)).toBe(2)
    expect(buf.readUInt16LE(0x80 + 92)).toBe(2)
  })

  it('refuses a file without the MZ magic number', () => {
    const buf = fakePE(3)
    buf.write('XX', 0, 'ascii')
    expect(() => patchToGui(buf)).toThrow(/MZ/)
  })

  it('refuses a file whose e_lfanew does not point at a PE signature', () => {
    const buf = fakePE(3)
    buf.writeUInt32LE(0, 0x80)
    expect(() => patchToGui(buf)).toThrow(/PE/)
  })

  it('refuses a subsystem it does not recognise, rather than corrupting it', () => {
    // 9 = WINDOWS_CE_GUI: a valid PE value, but not something our build emits.
    expect(() => patchToGui(fakePE(9))).toThrow(/unexpected PE subsystem 9/)
  })
})
