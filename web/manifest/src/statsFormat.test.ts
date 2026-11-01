import { describe, expect, it } from 'vitest'
import { change, pointsChange } from './statsFormat'

describe('change', () => {
  it('signs a rise and a fall, with a real minus sign', () => {
    expect(change(125, 100)).toBe('+25 %')
    expect(change(92, 100)).toBe('−8 %')
  })

  it('says when nothing changed', () => {
    expect(change(5, 5)).toBe('±0 %')
  })

  it('rounds to whole percent', () => {
    expect(change(8570, 7000)).toBe('+22 %')
  })

  // Growth from nothing has no percentage; "+∞ %" would be noise, not news.
  it('gives no change without a year to compare with', () => {
    expect(change(5, 0)).toBeNull()
    expect(change(5, null)).toBeNull()
    expect(change(5, undefined)).toBeNull()
  })
})

// A share that moves from 40 % to 50 % rose by ten points, not by 25 %.
describe('pointsChange', () => {
  it('compares shares in percentage points', () => {
    expect(pointsChange(50, 100, 40, 100)).toBe('+10 Pp.')
    expect(pointsChange(40, 100, 50, 100)).toBe('−10 Pp.')
    expect(pointsChange(1, 2, 5, 10)).toBe('±0 Pp.')
  })

  it('gives no change without a year to compare with', () => {
    expect(pointsChange(5, 10, null, null)).toBeNull()
    expect(pointsChange(5, 10, 0, 0)).toBeNull()
  })
})
