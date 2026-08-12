import fs from 'fs'
import path from 'path'
import os from 'os'
import { openDb } from '../../src/server/db'
import { buildServer } from '../../src/server/index'
import { DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../../src/server/config'
import type { Config } from '../../src/server/config'
import type { PickPath } from '../../src/server/routes/pickPath'

const templateBytes = fs.readFileSync(
  path.join(__dirname, '..', '..', 'assets', 'Befoerderungsvertrag.pdf')
)

export function testServer(
  cfgOverrides: Partial<Config> = {},
  notify?: (guestName: string) => void,
  pickPath?: PickPath
) {
  const cfgRef = {
    current: {
      exportDir: os.tmpdir(),
      contractText: '',
      privacyText: '',
      jumpLocation: '',
      backupDir: '',
      voucherListPath: '',
      prices: { ...DEFAULT_PRICES },
      payouts: { ...DEFAULT_PAYOUTS },
      ...cfgOverrides,
    },
  }
  const db = openDb(':memory:')
  return {
    app: buildServer(db, cfgRef, templateBytes, undefined, notify, pickPath),
    cfgRef,
    db,
  }
}
