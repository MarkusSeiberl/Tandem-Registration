import fs from 'fs'
import path from 'path'
import os from 'os'
import { openDb } from '../../src/server/db'
import { buildServer } from '../../src/server/index'
import type { Config } from '../../src/server/config'

const templateBytes = fs.readFileSync(
  path.join(__dirname, '..', '..', 'assets', 'Befoerderungsvertrag.pdf')
)

export function testServer(cfgOverrides: Partial<Config> = {}) {
  const cfgRef = {
    current: {
      exportDir: os.tmpdir(),
      contractText: '',
      jumpLocation: '',
      ...cfgOverrides,
    },
  }
  return { app: buildServer(openDb(':memory:'), cfgRef, templateBytes), cfgRef }
}
