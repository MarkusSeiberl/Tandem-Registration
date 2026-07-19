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
    // serve.ts clears + recreates the data/export dir and then boots the server
    // in one Node process (portable across Windows/Unix — see serve.ts for why
    // the old inline `rm -rf && mkdir -p` shell command was replaced).
    command: `npx tsx ${JSON.stringify('./tests/e2e/serve.ts')}`,
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
