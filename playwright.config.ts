import { defineConfig, devices } from '@playwright/test'
import { E2E_DIR, E2E_PORT } from './tests/e2e/env'

// Requires `npm run build:web` to have been run first (the server serves
// the built guest/manifest dist folders from <installDir>/web/{guest,manifest}/dist,
// and installDir === process.cwd() when run via tsx as below). We do NOT
// rebuild here so `npx playwright test` stays fast on repeat runs; the e2e
// npm script documents the required order.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
  },
  webServer: {
    // Start each run from a clean data/export dir, and do it HERE (not in a
    // globalSetup) so the ordering is deterministic: Playwright starts the
    // webServer BEFORE running globalSetup, so cleaning the dir in globalSetup
    // would rmSync it out from under the already-running server (the guest
    // db and the day's export must land in a dir that outlives the server).
    // Cleaning in the server's own launch command guarantees the dir is fresh
    // before better-sqlite3 opens <DIR>/tandem.db.
    command: `rm -rf ${JSON.stringify(E2E_DIR)} && mkdir -p ${JSON.stringify(E2E_DIR)} && npx tsx src/server/main.ts`,
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      PORT: String(E2E_PORT),
      DIR: E2E_DIR,
    },
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
