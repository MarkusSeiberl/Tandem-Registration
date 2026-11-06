// How the yearly report writes a change against last year and a share.

function signed(n: number, unit: string): string {
  if (n === 0) return `±0 ${unit}`
  // A real minus sign: the hyphen is too short to read as one in a figure.
  return `${n > 0 ? '+' : '−'}${Math.abs(n)} ${unit}`
}

/**
 * How much a count changed against the year before, in whole percent. null when
 * there is nothing to compare with: growth from zero has no percentage.
 */
export function change(now: number, before: number | null | undefined): string | null {
  if (before == null || before === 0) return null
  return signed(Math.round(((now - before) / before) * 100), '%')
}

/**
 * How much a share changed, in percentage points: from 40 % to 50 % is ten
 * points, which "+25 %" would hide. null without a year to compare with.
 */
export function pointsChange(
  part: number, whole: number, partBefore: number | null, wholeBefore: number | null,
): string | null {
  if (partBefore == null || !wholeBefore || !whole) return null
  return signed(Math.round((part / whole) * 100 - (partBefore / wholeBefore) * 100), 'Pp.')
}

export function share(part: number, whole: number): string {
  return whole === 0 ? '0 %' : `${Math.round((part / whole) * 100)} %`
}
