#!/usr/bin/env node
// Packages dist/server.cjs into dist/tandem.exe with @yao-pkg/pkg.
//
// The pkg target Node version is derived from THIS machine's Node version at
// build time — NOT hardcoded. This matters because better-sqlite3 is loaded as
// an external native binary (dist/better_sqlite3.node) that npm installed for
// this machine's Node ABI. If the exe embedded a different Node runtime, the
// native binary's NODE_MODULE_VERSION wouldn't match and it would fail to load
// at runtime (e.g. "compiled against NODE_MODULE_VERSION 137, requires 127").
// Targeting the build machine's own major keeps the embedded runtime and the
// shipped .node on the same ABI by construction.

import { exec } from '@yao-pkg/pkg';

const major = process.versions.node.split('.')[0];
const target = `node${major}-win-x64`;

console.log(
  `[tandem] Packaging exe for ${target} ` +
    `(build machine: Node ${process.versions.node}, ABI ${process.versions.modules}). ` +
    `The shipped better_sqlite3.node must match this ABI.`,
);

// --config pkg.config.json embeds the built web frontends (web/*/dist) into the
// exe. Passing it explicitly (rather than relying on package.json discovery)
// guarantees the assets are picked up when pkg is invoked on the bundled file.
await exec([
  'dist/server.cjs',
  '--config', 'pkg.config.json',
  '--targets', target,
  '--output', 'dist/tandem.exe',
]);
