import type { ReactNode } from 'react'

// Mirrors web/guest/src/richText.tsx — this file is what the settings preview
// draws with, so the two must agree character for character.

const BOLD = /(\*\*[\s\S]+?\*\*)/g

/**
 * Renders the club's texts, whose only markup is `**fett**`.
 *
 * Deliberately not Markdown: the texts are legal prose typed by a club official
 * in a textarea, where a stray underscore or hash is a stray underscore or
 * hash. One marker, one meaning, nothing else touched.
 *
 * A `**` without a partner stays on screen as two asterisks — visible, and
 * therefore fixable, which silently swallowing it would not be.
 */
export function renderRichText(text: string): ReactNode[] {
  return text
    .split(BOLD)
    .map((part, i) =>
      part.length > 4 && part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i}>{part.slice(2, -2)}</strong>
      ) : (
        part
      )
    )
}

export interface BoldToggle {
  value: string
  selectionStart: number
  selectionEnd: number
}

/**
 * Puts `**` around the selected text, or takes it away again when the selection
 * already carries it.
 *
 * Returns where the selection has to go afterwards as well as the new text: a
 * textarea whose value React replaces loses its selection, and an editor that
 * drops the cursor after every button press is an editor nobody uses. With
 * nothing selected it opens an empty pair and puts the cursor between the
 * markers, ready to type the bold words.
 */
export function toggleBold(value: string, start: number, end: number): BoldToggle {
  const selected = value.slice(start, end)

  if (selected.length > 4 && selected.startsWith('**') && selected.endsWith('**')) {
    const stripped = selected.slice(2, -2)
    return {
      value: value.slice(0, start) + stripped + value.slice(end),
      selectionStart: start,
      selectionEnd: start + stripped.length,
    }
  }

  // The same selection made from the inside, without the markers: the guest of
  // this function is a finger on a tablet, not a careful mouse.
  if (value.slice(start - 2, start) === '**' && value.slice(end, end + 2) === '**') {
    return {
      value: value.slice(0, start - 2) + selected + value.slice(end + 2),
      selectionStart: start - 2,
      selectionEnd: start - 2 + selected.length,
    }
  }

  return {
    value: `${value.slice(0, start)}**${selected}**${value.slice(end)}`,
    selectionStart: start + 2,
    selectionEnd: start + 2 + selected.length,
  }
}
