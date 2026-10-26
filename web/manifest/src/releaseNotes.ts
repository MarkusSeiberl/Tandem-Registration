// Where GitHub's generated tail starts: the pull-request list with its English
// headings, @handles and bare URLs, and the compare link. It is written for
// developers; the operator reads the club's own German notes above it.
const GENERATED_TAIL = /^(#{1,3}\s*(What's Changed|New Contributors)\b|\*\*Full Changelog\*\*)/i

/** The release notes up to GitHub's generated tail, trimmed. */
export function operatorNotes(text: string): string {
  const lines = text.split('\n')
  const cut = lines.findIndex((line) => GENERATED_TAIL.test(line.replace(/\r$/, '').trim()))
  return (cut === -1 ? lines : lines.slice(0, cut)).join('\n').trim()
}
