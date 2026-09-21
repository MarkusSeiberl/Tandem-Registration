import { describe, it, expect } from 'vitest'
// @ts-expect-error - build script, plain .mjs without type declarations
import { versionMismatch } from '../scripts/check-version-tag.mjs'

describe('check-version-tag', () => {
  it('accepts a tag that carries exactly the package version', () => {
    expect(versionMismatch('1.2.0', 'v1.2.0')).toBeNull()
  })

  it('accepts a tag written without the leading v', () => {
    expect(versionMismatch('1.2.0', '1.2.0')).toBeNull()
  })

  // The whole point: a release tagged v1.2.0 whose binary says 1.1.0 makes
  // every later version comparison wrong, in a way nobody notices until an
  // update loop starts.
  it('names both numbers when they disagree', () => {
    expect(versionMismatch('1.1.0', 'v1.2.0')).toMatch(/1\.1\.0.*1\.2\.0/)
  })

  // A working copy that sits on no tag at all is the normal state during
  // development — the build must not demand one.
  it('accepts no tag at all', () => {
    expect(versionMismatch('1.1.0', null)).toBeNull()
  })
})
