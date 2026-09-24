// Bundles the server AND stamps the version into it. The version cannot come
// from package.json at runtime: the packaged exe has no package.json next to
// it, and reading one out of pkg's snapshot would report the build machine's
// checkout, not this build.
import { build } from 'esbuild'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))

await build({
  entryPoints: [path.join(root, 'src/server/main.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['better-sqlite3'],
  outfile: path.join(root, 'dist/server.cjs'),
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
})

console.log(`[tandem] dist/server.cjs gebaut, Version ${pkg.version}`)
