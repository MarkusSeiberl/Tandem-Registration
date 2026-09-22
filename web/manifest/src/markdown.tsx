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

export function Markdown({ text }: { text: string }): ReactNode {
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim() !== '')

  return (
    <>
      {blocks.map((block, bi) => {
        const lines = block.split('\n')

        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={bi}>
              {lines.map((l, li) => (
                <li key={li}>{inline(l.slice(2), `${bi}-${li}`)}</li>
              ))}
            </ul>
          )
        }

        // A heading is its own block; anything after it in the same block is an
        // ordinary paragraph, which is how GitHub bodies are written anyway.
        const heading = /^(#{2,3})\s+(.*)$/.exec(lines[0])
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
