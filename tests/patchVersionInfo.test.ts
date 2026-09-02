import { describe, it, expect } from 'vitest'
// @ts-expect-error - build script, plain .mjs without type declarations
import {
  rsrcRange,
  readVersionStrings,
  patchVersionStrings,
  VERSION_STRINGS,
} from '../scripts/patch-version-info.mjs'

const align4 = (n: number) => (n + 3) & ~3

/**
 * Builds a VS_VERSION_INFO block the way a real Windows resource compiler
 * lays it out: length-prefixed blocks, UTF-16 keys and values, every child
 * starting on a 4-byte boundary. Only the parts the patcher walks are real —
 * the root's VS_FIXEDFILEINFO value is zeroed filler of the declared size.
 */
function versionResource(strings: Record<string, string>, langKey = '040904b0'): Buffer {
  const block = (key: string, value: string | null, children: Buffer[]): Buffer => {
    const head = Buffer.alloc(align4(6 + (key.length + 1) * 2))
    head.write(key + '\0', 6, 'ucs2')
    const body = value === null ? Buffer.alloc(0) : Buffer.from(value + '\0', 'ucs2')
    const parts = [head, body]
    let length = head.length + body.length
    for (const child of children) {
      const pad = Buffer.alloc(align4(length) - length)
      parts.push(pad, child)
      length = align4(length) + child.length
    }
    const buf = Buffer.concat(parts)
    buf.writeUInt16LE(length, 0)
    buf.writeUInt16LE(value === null ? 0 : value.length + 1, 2)
    buf.writeUInt16LE(value === null ? 1 : 1, 4)
    return buf
  }

  const entries = Object.entries(strings).map(([k, v]) => block(k, v, []))
  const table = block(langKey, null, entries)
  const stringFileInfo = block('StringFileInfo', null, [table])

  // The root carries a 52-byte VS_FIXEDFILEINFO as its value, then children.
  const fixed = Buffer.alloc(52)
  const root = block('VS_VERSION_INFO', null, [stringFileInfo])
  const head = Buffer.alloc(align4(6 + 'VS_VERSION_INFO\0'.length * 2))
  head.write('VS_VERSION_INFO\0', 6, 'ucs2')
  const rest = root.slice(align4(head.length))
  const out = Buffer.concat([head, fixed, rest])
  out.writeUInt16LE(out.length, 0)
  out.writeUInt16LE(52, 2)
  out.writeUInt16LE(0, 4)
  return out
}

/** The eight strings a stock node.exe ships, i.e. what pkg hands us. */
const nodeStrings = {
  CompanyName: 'Node.js',
  ProductName: 'Node.js',
  FileDescription: 'Node.js JavaScript Runtime',
  FileVersion: '24.18.0',
  ProductVersion: '24.18.0',
  OriginalFilename: 'node.exe',
  InternalName: 'node',
  LegalCopyright: 'Copyright Node.js contributors. MIT license.',
}

/** A PE64 header with a section table containing `.rsrc`. */
function fakePE(rsrcOffset: number, rsrcSize: number, peOffset = 0x80): Buffer {
  const buf = Buffer.alloc(peOffset + 512)
  buf.write('MZ', 0, 'ascii')
  buf.writeUInt32LE(peOffset, 0x3c)
  buf.writeUInt32LE(0x00004550, peOffset) // "PE\0\0"
  buf.writeUInt16LE(2, peOffset + 6) // two sections
  buf.writeUInt16LE(240, peOffset + 20) // optional header size
  const table = peOffset + 24 + 240
  buf.write('.text', table, 'latin1')
  buf.write('.rsrc', table + 40, 'latin1')
  buf.writeUInt32LE(rsrcSize, table + 40 + 16)
  buf.writeUInt32LE(rsrcOffset, table + 40 + 20)
  return buf
}

describe('patch-version-info', () => {
  it('finds the .rsrc section behind the optional header', () => {
    expect(rsrcRange(fakePE(91520000, 142336))).toEqual({ offset: 91520000, size: 142336 })
  })

  it('refuses a binary without a .rsrc section', () => {
    const buf = fakePE(0, 0)
    buf.write('.data', 0x80 + 24 + 240 + 40, 'latin1')
    expect(() => rsrcRange(buf)).toThrow(/no \.rsrc section/)
  })

  it('reads the version strings pkg inherits from node.exe', () => {
    expect(readVersionStrings(versionResource(nodeStrings))).toEqual(nodeStrings)
  })

  it('replaces the named strings and leaves the others alone', () => {
    const buf = versionResource(nodeStrings)
    const before = patchVersionStrings(buf, VERSION_STRINGS)

    expect(before).toEqual(nodeStrings)
    expect(readVersionStrings(buf)).toEqual({
      ...nodeStrings,
      ...VERSION_STRINGS,
    })
  })

  it('keeps the resource byte length identical, so no file offset moves', () => {
    const buf = versionResource(nodeStrings)
    const size = buf.length
    patchVersionStrings(buf, VERSION_STRINGS)
    expect(buf.length).toBe(size)
    expect(buf.readUInt16LE(0)).toBe(size) // root wLength untouched
  })

  it('is idempotent: patching an already-patched resource changes nothing', () => {
    const buf = versionResource(nodeStrings)
    patchVersionStrings(buf, VERSION_STRINGS)
    const once = Buffer.from(buf)
    const before = patchVersionStrings(buf, VERSION_STRINGS)

    expect(before).toMatchObject(VERSION_STRINGS)
    expect(buf.equals(once)).toBe(true)
  })

  it('grows a string into the space freed by a shrinking one', () => {
    const buf = versionResource(nodeStrings)
    patchVersionStrings(buf, { FileDescription: 'Tandem', InternalName: 'tandem-registrierung' })
    expect(readVersionStrings(buf)).toMatchObject({
      FileDescription: 'Tandem',
      InternalName: 'tandem-registrierung',
      LegalCopyright: 'Copyright Node.js contributors. MIT license.',
    })
  })

  it('refuses replacements that do not fit rather than shifting the payload', () => {
    const buf = versionResource(nodeStrings)
    expect(() => patchVersionStrings(buf, { FileDescription: 'x'.repeat(200) })).toThrow(
      /need \d+ bytes but only \d+ are available/,
    )
  })

  it('leaves the resource untouched when the replacements do not fit', () => {
    const buf = versionResource(nodeStrings)
    const original = Buffer.from(buf)
    expect(() => patchVersionStrings(buf, { ProductName: 'y'.repeat(500) })).toThrow()
    expect(buf.equals(original)).toBe(true)
  })

  it('refuses a resource without a version block', () => {
    expect(() => readVersionStrings(Buffer.alloc(256))).toThrow(/no VS_VERSION_INFO/)
  })

  it('the shipped strings fit into what node.exe reserved', () => {
    const buf = versionResource(nodeStrings)
    expect(() => patchVersionStrings(buf, VERSION_STRINGS)).not.toThrow()
  })
})
