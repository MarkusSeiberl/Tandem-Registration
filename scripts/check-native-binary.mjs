#!/usr/bin/env node
// Preflight guard for `npm run build:exe`.
//
// The Windows exe ships better_sqlite3.node as a real file beside tandem.exe
// (copied by scripts/copy-native-binary.mjs). On a non-Windows build box the
// file in node_modules is whatever native binary was last built/installed
// locally (a Linux ELF or macOS Mach-O), NOT a Windows PE/DLL. If we copied
// that beside the exe, better-sqlite3 would fail to dlopen() on Windows.
//
// This script checks the first two bytes of the .node file for the "MZ"
// PE magic number before pkg runs, so a wrong-platform binary fails the
// build loudly instead of shipping a broken exe.
//
// Dependency-free by design (only node:fs / node:path) so it stays cheap
// to run before every build:exe invocation.

import { openSync, readSync, closeSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const nativeBinaryPath = path.join(
  projectRoot,
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
);

if (!existsSync(nativeBinaryPath)) {
  console.error(
    `\nERROR: native binary not found at:\n  ${nativeBinaryPath}\n\n` +
      'Run `npm install` first, or obtain the win32-x64 prebuild via:\n' +
      '  npx prebuild-install --platform=win32 --arch=x64\n' +
      '(see build.md, "Native module: how the Windows better_sqlite3.node is obtained")\n',
  );
  process.exit(1);
}

// Read just the first 2 bytes; a Windows PE binary (.exe/.dll) always
// starts with the "MZ" magic number (0x4D 0x5A), the legacy DOS header
// signature that every PE file retains for backwards compatibility.
const header = Buffer.alloc(2);
const fd = openSync(nativeBinaryPath, 'r');
try {
  readSync(fd, header, 0, 2, 0);
} finally {
  closeSync(fd);
}

const isWindowsPE = header[0] === 0x4d && header[1] === 0x5a;

if (!isWindowsPE) {
  console.error(
    '\n' +
      '############################################################\n' +
      '# BUILD ABORTED: better-sqlite3 native binary is NOT a     #\n' +
      '# Windows (PE) binary.                                     #\n' +
      '############################################################\n\n' +
      `File: ${nativeBinaryPath}\n` +
      `First 2 bytes: 0x${header[0].toString(16).padStart(2, '0')} 0x${header[1]
        .toString(16)
        .padStart(2, '0')} (expected 0x4d 0x5a, "MZ")\n\n` +
      'This file would be copied beside dist/tandem.exe, producing a\n' +
      'real-but-BROKEN deployment: better-sqlite3 will fail to load at\n' +
      'runtime on Windows.\n\n' +
      'Fix: fetch the win32-x64 prebuild before building the exe:\n' +
      '  npx prebuild-install --platform=win32 --arch=x64\n' +
      '(see build.md, "Native module: how the Windows better_sqlite3.node is obtained")\n\n' +
      'After building the exe, restore your own platform binary for local\n' +
      'dev/tests with:\n' +
      '  rm -rf node_modules/better-sqlite3/build && npm rebuild better-sqlite3\n',
  );
  process.exit(1);
}

console.log(
  `OK: ${path.relative(projectRoot, nativeBinaryPath)} is a Windows PE binary ("MZ" magic number present).`,
);
process.exit(0);
