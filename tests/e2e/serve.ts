// Cross-platform e2e server launcher. Playwright runs webServer.command through
// the OS default shell (cmd.exe on Windows), where Unix `rm -rf`/`mkdir -p`
// break — `mkdir -p X` there creates a literal `-p` directory. Doing the
// clean-then-boot in Node instead is portable and keeps the ordering the
// config relies on: the data/export dir is fresh in the SAME process that then
// boots the server (via importing main), before better-sqlite3 opens the db.
import fs from 'fs'
import { E2E_DIR } from './env'

fs.rmSync(E2E_DIR, { recursive: true, force: true })
fs.mkdirSync(E2E_DIR, { recursive: true })

// main.ts reads process.env.DIR/PORT at import time; Playwright already sets
// both via webServer.env, so importing it here starts the server. No
// top-level await — the dynamic import runs main.ts (which calls app.listen)
// on its own.
void import('../../src/server/main')
