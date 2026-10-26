#!/usr/bin/env node
// A stand-in for GitHub's "latest release" API, for the update test set up by
// setup.mjs (runbook: auto-update-handtest.md). One server answers every
// scenario at once, each under its own path, so all test installs can run side
// by side without restarting anything:
//
//   /ok/latest        the real release, correct checksums -> update succeeds
//   /checksum/latest  the real release, wrong exe checksum -> download rejected
//   /broken/latest    a truncated exe with a matching checksum -> the download
//                     passes, the new exe cannot start, the install rolls back
//
// Checksums are computed from the files at startup, so nothing is maintained by
// hand. Usage: node fake-release-server.mjs <test root> [port]

import { createHash } from 'crypto'
import { createReadStream, readFileSync, statSync } from 'fs'
import { createServer } from 'http'
import path from 'path'

const root = process.argv[2]
const port = Number(process.argv[3]) || 8099
if (!root) {
  console.error('Usage: node fake-release-server.mjs <test root> [port]')
  process.exit(1)
}

const setup = JSON.parse(readFileSync(path.join(root, 'setup.json'), 'utf8'))
const FILES = ['tandem.exe', 'better_sqlite3.node']

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

// Written the way GitHub writes release bodies: a heading straight above its
// list, and the generated tail the manifest is meant to leave out.
const NOTES = [
  'Testrelease für den Update-Handtest.',
  '',
  '## Neu',
  '- **Update-Test**: diese Version kommt vom lokalen Fake-Server',
  '- Kassieren und Tagesabschluss unverändert',
  '',
  "## What's Changed",
  '* Test entry by @someone in https://github.com/example/pull/1',
  '',
  '**Full Changelog**: https://github.com/example/compare/v0...v1',
].join('\n')

function scenario(name, dir, { wrongExeDigest = false } = {}) {
  const assets = FILES.map((file) => {
    const full = path.join(root, dir, file)
    const digest = wrongExeDigest && file === 'tandem.exe'
      ? createHash('sha256').update('not the file that will be served').digest('hex')
      : sha256(full)
    return {
      name: file,
      size: statSync(full).size,
      digest: `sha256:${digest}`,
      browser_download_url: `http://127.0.0.1:${port}/${name}/${file}`,
    }
  })
  return { dir, release: { tag_name: `v${setup.releaseVersion}`, body: NOTES, assets } }
}

console.log('[fake-release] computing checksums …')
const SCENARIOS = {
  ok: scenario('ok', 'release'),
  checksum: scenario('checksum', 'release', { wrongExeDigest: true }),
  broken: scenario('broken', 'release-broken'),
}

const server = createServer((req, res) => {
  const [, name, rest] = (req.url ?? '').split('/')
  const sc = SCENARIOS[name]
  console.log(`[fake-release] ${req.method} ${req.url}${sc ? '' : '  (unknown scenario)'}`)
  if (!sc) {
    res.writeHead(404).end()
    return
  }
  if (rest === 'latest') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(sc.release))
    return
  }
  if (FILES.includes(rest)) {
    const full = path.join(root, sc.dir, rest)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': statSync(full).size,
    })
    createReadStream(full).pipe(res)
    return
  }
  res.writeHead(404).end()
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[fake-release] läuft auf http://127.0.0.1:${port}`)
  console.log(`[fake-release] Release v${setup.releaseVersion}, installiert ist ${setup.installedVersion}`)
  for (const name of Object.keys(SCENARIOS)) {
    console.log(`  /${name}/latest`)
  }
})
