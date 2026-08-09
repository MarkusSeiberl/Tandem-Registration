import fs from 'fs'
import path from 'path'
import os from 'os'
import { openDb } from '../../src/server/db'
import { buildServer } from '../../src/server/index'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../../src/server/config'
import type { Config } from '../../src/server/config'

const templateBytes = fs.readFileSync(
  path.join(__dirname, '..', '..', 'assets', 'Befoerderungsvertrag.pdf')
)

export function testServer(
  cfgOverrides: Partial<Config> = {},
  notify?: (guestName: string) => void
) {
  const cfgRef = {
    current: {
      exportDir: os.tmpdir(),
      contractText: '',
      privacyText: '',
      jumpLocation: '',
      backupDir: '',
      prices: { ...DEFAULT_PRICES },
      payouts: { ...DEFAULT_PAYOUTS },
      ...cfgOverrides,
    },
  }
  return { app: buildServer(openDb(':memory:'), cfgRef, templateBytes, undefined, notify), cfgRef }
}
