import type { ReactNode } from 'react'

// Mirrors web/guest/src/richText.tsx — this file is what the settings preview
// draws with, so the two must agree character for character.

// Ordered longest first: '***' has to be recognised as one token before '**'
// gets to claim its first two stars, and '**' before the single star that makes
// text italic. Anything not matched here is text and stays text.
const TOKEN = /(\*\*\*[\s\S]+?\*\*\*|\*\*[\s\S]+?\*\*|__[\s\S]+?__|\*[\s\S]+?\*)/g

// Tried in this order for the same reason. '**' is listed before '*' so that
// '***fett kursiv***' peels the bold off first and leaves '*fett kursiv*' for
// the recursion below.
const RULES = [
  { marker: '**', tag: 'strong' },
  { marker: '__', tag: 'u' },
  { marker: '*', tag: 'em' },
] as const

export type Marker = (typeof RULES)[number]['marker']

// How many copies of `ch` sit in an unbroken run ending at / starting at `i`.
function runBefore(text: string, i: number, ch: string): number {
  let n = 0
  while (i - n > 0 && text[i - n - 1] === ch) n += 1
  return n
}

function runAfter(text: string, i: number, ch: string): number {
  let n = 0
  while (i + n < text.length && text[i + n] === ch) n += 1
  return n
}

/**
 * Whether a run of `run` marker characters is a reading of `marker`.
 *
 * Stars are the only ambiguous case: one is kursiv, two are fett, three are
 * both. Reading the run rather than the first character is what keeps „Kursiv"
 * from peeling a single star off **fett** and quietly turning it into *kursiv*.
 */
function runCarries(run: number, marker: string): boolean {
  if (marker[0] === '_') return run === marker.length
  return run === marker.length || run === 3
}

/** Whether `text` is one span marked with `marker`, markers included. */
function carries(text: string, marker: string): boolean {
  const ch = marker[0]
  const lead = runAfter(text, 0, ch)
  if (lead !== runBefore(text, text.length, ch)) return false
  if (!runCarries(lead, marker)) return false
  // Nothing between the markers is not a span. An empty pair stays on screen as
  // the characters it is made of — visible, and therefore fixable.
  return text.length > lead * 2
}

/**
 * Renders the club's texts, whose only markup is `**fett**`, `*kursiv*` and
 * `__unterstrichen__`.
 *
 * Deliberately not Markdown: the texts are legal prose typed by a club official
 * in a textarea, where a stray hash or bracket is a stray hash or bracket. Three
 * markers, three meanings, nothing else touched.
 *
 * A marker without a partner stays on screen as the characters it is made of —
 * visible, and therefore fixable, which silently swallowing it would not be.
 *
 * The recursion is what lets the markers combine: the toolbar can put kursiv
 * inside fett, and `***so***` or `**__so__**` come out as both.
 */
export function renderRichText(text: string): ReactNode[] {
  return text.split(TOKEN).map((part, i) => {
    const rule = RULES.find((r) => carries(part, r.marker))
    if (!rule) return part
    const Tag = rule.tag
    return <Tag key={i}>{renderRichText(part.slice(rule.marker.length, -rule.marker.length))}</Tag>
  })
}

export interface MarkerToggle {
  value: string
  selectionStart: number
  selectionEnd: number
}

/**
 * Puts `marker` around the selected text, or takes it away again when the
 * selection already carries it.
 *
 * Returns where the selection has to go afterwards as well as the new text: a
 * textarea whose value React replaces loses its selection, and an editor that
 * drops the cursor after every button press is an editor nobody uses. With
 * nothing selected it opens an empty pair and puts the cursor between the
 * markers, ready to type the marked words.
 */
export function toggleMarker(
  value: string,
  start: number,
  end: number,
  marker: Marker
): MarkerToggle {
  const width = marker.length
  const ch = marker[0]
  const selected = value.slice(start, end)

  if (carries(selected, marker)) {
    const stripped = selected.slice(width, -width)
    return {
      value: value.slice(0, start) + stripped + value.slice(end),
      selectionStart: start,
      selectionEnd: start + stripped.length,
    }
  }

  // The same selection made from the inside, without the markers: the guest of
  // this function is a finger on a tablet, not a careful mouse. The run on both
  // sides has to be one this marker is part of, so pressing „Kursiv" inside
  // **fett** wraps the words instead of stealing one of the bold stars.
  const outside = runBefore(value, start, ch)
  if (outside === runAfter(value, end, ch) && runCarries(outside, marker)) {
    return {
      value: value.slice(0, start - width) + selected + value.slice(end + width),
      selectionStart: start - width,
      selectionEnd: start - width + selected.length,
    }
  }

  return {
    value: `${value.slice(0, start)}${marker}${selected}${marker}${value.slice(end)}`,
    selectionStart: start + width,
    selectionEnd: start + width + selected.length,
  }
}
