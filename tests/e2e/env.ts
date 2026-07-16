// Single source of truth for the fixed test port and the on-disk data/export
// directory used by the e2e run. playwright.config.ts imports these for the
// webServer command/env and the baseURL/health url.
import path from 'path'

export const E2E_PORT = 8130
export const E2E_DIR = path.resolve(__dirname, '../../.tmp-e2e')
