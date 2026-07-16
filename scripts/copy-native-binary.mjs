#!/usr/bin/env node
// Post-build step for `npm run build:exe`.
//
// pkg cannot serve a native .node addon out of its virtual /snapshot
// filesystem, so we do NOT embed better_sqlite3.node into the exe. Instead we
// copy it into dist/ as a real file beside tandem.exe; main.ts loads it from
// there via better-sqlite3's `nativeBinding` option. The whole install folder
// (tandem.exe + better_sqlite3.node + web/ + config.json) ships together.
//
// Dependency-free (only node:fs / node:path).

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const src = path.join(
  projectRoot,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);
const distDir = path.join(projectRoot, 'dist');
const dest = path.join(distDir, 'better_sqlite3.node');

if (!existsSync(src)) {
  console.error(`\nERROR: native binary not found at:\n  ${src}\nRun the build:exe guard / npm install first.\n`);
  process.exit(1);
}

mkdirSync(distDir, { recursive: true });
copyFileSync(src, dest);
console.log(`OK: copied better_sqlite3.node -> ${path.relative(projectRoot, dest)} (ship beside tandem.exe)`);
