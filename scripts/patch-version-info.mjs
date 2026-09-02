#!/usr/bin/env node
// Post-processing step for `npm run build:exe`, sibling of patch-subsystem.mjs.
//
// `pkg` builds the exe on top of a stock `node.exe` and inherits its Windows
// version resource. Windows names a running process after that resource's
// `FileDescription` field, so the Task Manager lists tandem.exe as "Node.js
// JavaScript Runtime" — the operator cannot tell which process is the
// registration server. This rewrites the version strings so it shows up as
// "Tandem Registrierung".
//
// Why the resource is edited BYTE-FOR-BYTE IN PLACE and never rebuilt:
// `pkg` appends its payload (bundled sources and assets, ~22 MB) AFTER the last
// PE section and addresses it by absolute file offset. Any tool that
// regenerates the PE (rcedit, resedit, …) drops or displaces that payload and
// yields an exe that no longer starts. So this patcher leaves the file size and
// every existing offset untouched: it only rewrites bytes inside the
// StringTable of VS_VERSION_INFO, keeping that table's own length constant.
//
// That fixed length is the one real constraint: the replacement strings must
// fit into the space the Node ones occupied (per 4-byte-aligned struct).
// Leftover bytes are absorbed by the last entry, whose declared length is
// inflated to cover them — a String struct may be longer than its content,
// readers take the value via wValueLength. If the new strings do not fit, the
// script fails loudly instead of shifting anything.
//
// Version resource layout (all little-endian, strings UTF-16):
//   wLength (2) | wValueLength (2) | wType (2) | szKey + NUL | pad4 | value
// nested as VS_VERSION_INFO > StringFileInfo > <langcodepage> > String*.
// Children are walked by wLength, each starting on a 4-byte boundary.
//
// Dependency-free by design, like the other build scripts.

import { openSync, readSync, writeSync, closeSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

/** Version strings to overwrite. Keys absent here keep their Node value. */
export const VERSION_STRINGS = {
  FileDescription: 'Tandem Registrierung',
  ProductName: 'Tandem',
  InternalName: 'tandem',
  OriginalFilename: 'tandem.exe',
};

const align4 = (n) => (n + 3) & ~3;

/** Reads a NUL-terminated UTF-16 string at `off`; returns [text, offsetAfterNUL]. */
function readSz(buf, off) {
  let end = off;
  while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
  return [buf.slice(off, end).toString('ucs2'), end + 2];
}

/**
 * Locates the `.rsrc` section of a PE image in a buffer holding its headers.
 * Returns { offset, size } of the section's raw data, or throws.
 */
export function rsrcRange(header) {
  if (header.length < 0x40 || header[0] !== 0x4d || header[1] !== 0x5a) {
    throw new Error('not a PE file: missing "MZ" magic number');
  }
  const pe = header.readUInt32LE(0x3c);
  if (pe + 24 > header.length || header.readUInt32LE(pe) !== 0x00004550) {
    throw new Error('not a PE file: missing "PE\\0\\0" signature');
  }
  const sectionCount = header.readUInt16LE(pe + 6);
  const sectionTable = pe + 24 + header.readUInt16LE(pe + 20);
  if (sectionTable + sectionCount * 40 > header.length) {
    throw new Error('PE section table lies beyond the bytes read');
  }
  for (let i = 0; i < sectionCount; i++) {
    const entry = sectionTable + i * 40;
    const name = header.slice(entry, entry + 8).toString('latin1').replace(/\0+$/, '');
    if (name === '.rsrc') {
      return { offset: header.readUInt32LE(entry + 20), size: header.readUInt32LE(entry + 16) };
    }
  }
  throw new Error('PE has no .rsrc section — nothing to patch');
}

/**
 * Finds the StringTable (the <langcodepage> block) in a buffer that contains a
 * version resource. Returns the offsets bounding its String entries.
 */
export function findStringTable(buf) {
  const marker = Buffer.from('VS_VERSION_INFO\0', 'ucs2');
  const first = buf.indexOf(marker);
  if (first === -1) throw new Error('no VS_VERSION_INFO block found');
  if (buf.indexOf(marker, first + 2) !== -1) {
    throw new Error('several VS_VERSION_INFO blocks found — refusing to guess');
  }

  const root = first - 6;
  const rootEnd = root + buf.readUInt16LE(root);
  // Skip the root's own value (a VS_FIXEDFILEINFO) to reach its children.
  let child = align4(align4(first + marker.length) + buf.readUInt16LE(root + 2));

  for (; child < rootEnd; child += align4(buf.readUInt16LE(child))) {
    const [key, afterKey] = readSz(buf, child + 6);
    if (key !== 'StringFileInfo') continue;
    // The first (for a pkg/Node binary, the only) language-specific table.
    const table = align4(afterKey);
    const tableEnd = table + buf.readUInt16LE(table);
    const [, afterLang] = readSz(buf, table + 6);
    return { start: align4(afterLang), end: tableEnd };
  }
  throw new Error('VS_VERSION_INFO has no StringFileInfo block');
}

/** Reads the key/value pairs of the version resource in `buf`. */
export function readVersionStrings(buf) {
  const { start, end } = findStringTable(buf);
  const strings = {};
  for (let at = start; at < end; at += align4(buf.readUInt16LE(at))) {
    const [key, afterKey] = readSz(buf, at + 6);
    const value = at + align4(afterKey - at);
    // wValueLength counts WORDs including the NUL terminator.
    strings[key] = buf.slice(value, value + buf.readUInt16LE(at + 2) * 2 - 2).toString('ucs2');
  }
  return strings;
}

/**
 * Rewrites the version strings in place, keeping the StringTable's length — and
 * with it every offset in the file — unchanged.
 * Returns the values found before patching, so the caller can tell an actual
 * patch from a re-run on an already-patched exe.
 */
export function patchVersionStrings(buf, replacements) {
  const { start, end } = findStringTable(buf);
  const before = readVersionStrings(buf);
  const entries = Object.entries(before).map(([key, value]) => [
    key,
    Object.hasOwn(replacements, key) ? replacements[key] : value,
  ]);

  // Lay the entries out back to back, each starting on a 4-byte boundary.
  const encoded = [];
  let at = start;
  for (const [key, value] of entries) {
    at = align4(at);
    const valueAt = at + align4(6 + (key.length + 1) * 2);
    const structEnd = valueAt + (value.length + 1) * 2;
    encoded.push({ at, valueAt, structEnd, key, value });
    at = structEnd;
  }
  if (at > end) {
    throw new Error(
      `replacement strings need ${at - start} bytes but only ${end - start} are available; ` +
        'shorten them (the resource cannot grow without moving the pkg payload)',
    );
  }

  buf.fill(0, start, end);
  encoded.forEach((entry, i) => {
    // The last entry declares the leftover bytes as its own padding, so walking
    // the table's children ends exactly where the table does.
    const last = i === encoded.length - 1;
    buf.writeUInt16LE((last ? end : entry.structEnd) - entry.at, entry.at);
    buf.writeUInt16LE(entry.value.length + 1, entry.at + 2);
    buf.writeUInt16LE(1, entry.at + 4); // wType: text
    buf.write(entry.key + '\0', entry.at + 6, 'ucs2');
    buf.write(entry.value + '\0', entry.valueAt, 'ucs2');
  });

  return before;
}

function main() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const exePath = path.join(path.resolve(__dirname, '..'), 'dist', 'tandem.exe');

  let fd;
  try {
    fd = openSync(exePath, 'r+');
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`\nERROR: ${exePath} not found — run scripts/build-exe.mjs first.\n`);
    } else if (err.code === 'EBUSY') {
      // Windows locks a running image: the exe is still open somewhere.
      console.error(`\nERROR: ${exePath} is locked — close the running tandem.exe first.\n`);
    } else {
      console.error(`\nERROR: cannot open ${exePath}: ${err.message}\n`);
    }
    process.exit(1);
  }

  try {
    // Only the headers and the .rsrc section are touched: the exe is >100 MB
    // and every other byte stays as pkg wrote it.
    const header = Buffer.alloc(4096);
    readSync(fd, header, 0, header.length, 0);
    const rsrc = rsrcRange(header);
    if (rsrc.offset + rsrc.size > statSync(exePath).size) {
      throw new Error('.rsrc section reaches past the end of the file');
    }

    const buf = Buffer.alloc(rsrc.size);
    readSync(fd, buf, 0, rsrc.size, rsrc.offset);
    const before = patchVersionStrings(buf, VERSION_STRINGS);

    if (Object.entries(VERSION_STRINGS).every(([key, value]) => before[key] === value)) {
      console.log('[tandem] exe already carries the Tandem version strings — nothing to patch.');
      return;
    }

    writeSync(fd, buf, 0, rsrc.size, rsrc.offset);
    console.log(
      '[tandem] Patched exe version info: FileDescription ' +
        `"${before.FileDescription}" -> "${VERSION_STRINGS.FileDescription}" ` +
        '(the name Windows shows in the Task Manager).',
    );
  } catch (err) {
    console.error(`\nERROR: cannot patch version info of ${exePath}: ${err.message}\n`);
    process.exit(1);
  } finally {
    closeSync(fd);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
