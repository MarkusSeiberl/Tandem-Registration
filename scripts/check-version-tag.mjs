// The version inside the binary and the tag a release is published under must
// be the same number. If they drift, the updater compares the tag on GitHub
// against a different number in the running exe — an update that reinstalls
// itself forever, or one that never appears at all.
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The message to abort with, or null when everything lines up. */
export function versionMismatch(pkgVersion, tag) {
  // No tag: an ordinary development build. Nothing to compare against.
  if (!tag) return null
  const tagged = tag.startsWith('v') ? tag.slice(1) : tag
  if (tagged === pkgVersion) return null
  return (
    `package.json sagt ${pkgVersion}, der Git-Tag sagt ${tagged}.\n` +
    `Entweder die Version in package.json anheben oder den Tag korrigieren — ` +
    `sonst trägt das Release eine andere Zahl als das Binary.`
  )
}

/** The tag pointing exactly at HEAD, or null when HEAD carries none. */
export function currentTag() {
  try {
    return execFileSync('git', ['describe', '--tags', '--exact-match'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

// Manual file:// string-building breaks on Windows: import.meta.url gets a
// third slash after the scheme (file:///C:/...) that a naive template
// literal never adds, so the comparison was always false and the guard
// silently never ran. pathToFileURL normalizes both sides the same way.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const problem = versionMismatch(pkg.version, currentTag())
  if (problem) {
    console.error(`\nERROR: ${problem}\n`)
    process.exit(1)
  }
}
