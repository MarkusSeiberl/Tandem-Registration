import type { ReactNode } from 'react'

/**
 * The slice of Markdown the GitHub release notes actually use — headings, bold,
 * inline code, dash lists, paragraphs.
 *
 * Written out rather than pulled in: the text arrives from the internet, and
 * everything here produces React elements, never HTML. There is no path from a
 * release body to an executed tag.
 */

// Split on the two inline forms at once so the parts alternate predictably.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g

// Matches an ATX heading line. Only ## and ### are recognised: the screen's
// own title is an h2, and h1 is reserved for it — never produced here.
const HEADING = /^(#{2,3})\s+(.*)$/

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key}>{part.slice(1, -1)}</code>
    }
    return part
  })
}

// GitHub ends a block at every ATX heading, blank line or not — a heading
// line is never swallowed into the paragraph before or after it. Group raw
// lines into blocks on that rule instead of only splitting on blank lines,
// so a heading is recognised wherever it appears, not only as a block's
// first line.
function splitBlocks(text: string): string[][] {
  const blocks: string[][] = []
  let current: string[] = []

  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      if (current.length > 0) {
        blocks.push(current)
        current = []
      }
      continue
    }

    // A heading always starts a fresh block, even mid-paragraph.
    if (HEADING.test(line) && current.length > 0) {
      blocks.push(current)
      current = []
    }

    current.push(line)
  }

  if (current.length > 0) blocks.push(current)

  return blocks
}

export function Markdown({ text }: { text: string }): ReactNode {
  const blocks = splitBlocks(text)

  return (
    <>
      {blocks.map((lines, bi) => {
        // A block is a list once its first line opens with "- ". A later
        // line that doesn't is a lazy continuation of the item above it —
        // that's how GitHub reads it too — not a reason to fall back to a
        // paragraph and lose the whole list.
        if (lines[0].startsWith('- ')) {
          const items: string[] = []
          for (const line of lines) {
            if (line.startsWith('- ')) {
              items.push(line.slice(2))
            } else if (items.length > 0) {
              items[items.length - 1] += ` ${line}`
            }
          }
          return (
            <ul key={bi}>
              {items.map((item, li) => (
                <li key={li}>{inline(item, `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }

        // A heading is its own block (see splitBlocks); anything after it in
        // the same block is an ordinary paragraph, which is how GitHub bodies
        // are written anyway.
        const heading = HEADING.exec(lines[0])
        if (heading) {
          const rest = lines.slice(1).join(' ')
          // ## becomes h3: the screen's own title is the h2.
          const Tag = heading[1].length === 2 ? 'h3' : 'h4'
          return (
            <div key={bi}>
              <Tag>{inline(heading[2], `${bi}-h`)}</Tag>
              {rest.trim() !== '' && <p>{inline(rest, `${bi}-r`)}</p>}
            </div>
          )
        }

        return <p key={bi}>{inline(lines.join(' '), `${bi}`)}</p>
      })}
    </>
  )
}
