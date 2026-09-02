#!/usr/bin/env node
// Post-processing step for `npm run build:exe`.
//
// `pkg` always emits a PE with subsystem = WINDOWS_CUI (3, "console"). Windows
// gives every such process a console window and a taskbar button, so
// double-clicking tandem.exe pops a black terminal the operator neither needs
// nor should close (closing it kills the server mid-registration). Flipping the
// subsystem byte to WINDOWS_GUI (2) makes the exe start with no window at all;
// the operator's entry point is the browser page that main.ts opens, and the
// manifest's "Programm beenden" button ends it.
//
// Consequence, handled in src/server/main.ts: a GUI-subsystem process has no
// console, so console.log/console.error go nowhere. Fatal startup problems are
// shown in a Windows message box there instead of printed.
//
// Where the byte sits: the DOS header holds `e_lfanew` (a 4-byte LE offset to
// the PE signature) at 0x3C. After the 4-byte signature comes the 20-byte COFF
// header, then the optional header, whose Subsystem field is at offset 68 in
// both PE32 and PE32+. So: e_lfanew + 4 + 20 + 68 = e_lfanew + 92.
//
// Dependency-free by design, like the other build scripts.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export const IMAGE_SUBSYSTEM_WINDOWS_GUI = 2;
export const IMAGE_SUBSYSTEM_WINDOWS_CUI = 3;

/** Byte offset of the PE optional header's Subsystem field, or throws. */
export function subsystemOffset(buf) {
  if (buf.length < 0x40 || buf[0] !== 0x4d || buf[1] !== 0x5a) {
    throw new Error('not a PE file: missing "MZ" magic number');
  }
  const peOffset = buf.readUInt32LE(0x3c);
  if (peOffset + 96 > buf.length) {
    throw new Error(`not a PE file: e_lfanew (${peOffset}) points outside the file`);
  }
  if (buf.readUInt32LE(peOffset) !== 0x00004550) {
    throw new Error('not a PE file: missing "PE\0\0" signature');
  }
  return peOffset + 92;
}

/**
 * Rewrites the subsystem to WINDOWS_GUI in place.
 * Returns the subsystem found before patching, so the caller can tell an
 * actual patch from a re-run on an already-patched file.
 */
export function patchToGui(buf) {
  const offset = subsystemOffset(buf);
  const before = buf.readUInt16LE(offset);
  if (before !== IMAGE_SUBSYSTEM_WINDOWS_CUI && before !== IMAGE_SUBSYSTEM_WINDOWS_GUI) {
    throw new Error(`unexpected PE subsystem ${before}; expected 2 (GUI) or 3 (console)`);
  }
  buf.writeUInt16LE(IMAGE_SUBSYSTEM_WINDOWS_GUI, offset);
  return before;
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const exePath = path.join(path.resolve(__dirname, '..'), 'dist', 'tandem.exe');

  let buf;
  try {
    buf = readFileSync(exePath);
  } catch {
    console.error(
      `\nERROR: ${exePath} not found — run scripts/build-exe.mjs first.\n`,
    );
    process.exit(1);
  }

  let before;
  try {
    before = patchToGui(buf);
  } catch (err) {
    console.error(`\nERROR: cannot patch ${exePath}: ${err.message}\n`);
    process.exit(1);
  }

  if (before === IMAGE_SUBSYSTEM_WINDOWS_GUI) {
    console.log('[tandem] exe is already a GUI-subsystem binary — nothing to patch.');
    return;
  }

  writeFileSync(exePath, buf);
  console.log('[tandem] Patched PE subsystem 3 (console) -> 2 (GUI): exe starts without a terminal window.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
