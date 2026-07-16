import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // web/guest has its own vitest config (jsdom) and is run separately.
    // tests/e2e/** are Playwright specs, run via `playwright test`, not vitest.
    exclude: [...configDefaults.exclude, 'web/**', 'tests/e2e/**']
  }
})
