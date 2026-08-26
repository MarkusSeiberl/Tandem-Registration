import path from 'path'

// The marker `@yao-pkg/pkg` injects into the packaged process at runtime. A dev
// run via tsx or plain node does not have it — see build.md for why this is the
// detection rather than anything derived from process.execPath.
export const isPackaged = typeof (process as unknown as { pkg?: unknown }).pkg !== 'undefined'

// Where tandem.exe sits, or the checkout in dev.
export const installDir = isPackaged ? path.dirname(process.execPath) : process.cwd()

/**
 * A file that ships with the program: the contract template, the fonts it is
 * drawn with.
 *
 * The two modes differ because `pkg` embeds `assets/**` into the exe's virtual
 * snapshot rather than beside it. There the tree hangs off the bundled
 * `dist/server.cjs`, so `assets` is one level up from __dirname; in dev it is
 * simply the checkout's own folder.
 *
 * Everything reached through here is read-only and read with `fs` — which works
 * against the snapshot, unlike @fastify/static (see main.ts).
 */
export function assetPath(name: string): string {
  return isPackaged
    ? path.join(__dirname, '..', 'assets', name)
    : path.join(installDir, 'assets', name)
}
