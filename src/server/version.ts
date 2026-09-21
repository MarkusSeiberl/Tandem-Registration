import fs from 'fs'
import path from 'path'

// Replaced at bundle time by scripts/build-server.mjs. esbuild substitutes the
// identifier textually, so it simply does not exist in a dev run via tsx —
// hence the typeof guard rather than a truthiness check.
declare const __APP_VERSION__: string

function fromPackageJson(): string {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0'
  } catch {
    // A dev run started from somewhere else. The version only decides whether
    // an update is offered, and the dev run never updates itself anyway.
    return '0.0.0'
  }
}

/** The version this build is. The number a GitHub release tag is compared to. */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === 'undefined' ? fromPackageJson() : __APP_VERSION__
