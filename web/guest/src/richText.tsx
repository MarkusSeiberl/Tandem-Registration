import type { ReactNode } from 'react'

// Mirrors web/manifest/src/richText.tsx — the settings screen previews exactly
// what this renders, so the two must agree character for character.

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
