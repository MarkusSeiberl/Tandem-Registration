import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import type { Config } from '../config'

// A timestamp safe for filenames on every OS: no colons. 2026-07-19_14-30-05.
//
// Local time, like the voucher list's backup beside it (see voucherRedeem.ts):
// a backup taken just after local midnight would otherwise carry yesterday's
// date and sort in among the previous day's files, and the two backup kinds in
// the same folder would name the same moment differently.
function stamp(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `${date}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
}

export function registerBackupRoutes(app: FastifyInstance, db: Database, cfgRef: { current: Config }) {
  app.post('/api/backup', async (_req, reply) => {
    // backupDir is optional; fall back to the export directory when unset.
    const dir = cfgRef.current.backupDir?.trim() || cfgRef.current.exportDir
    await fs.mkdir(dir, { recursive: true })
    const filePath = path.join(dir, `tandem_backup_${stamp()}.db`)
    // better-sqlite3's online backup produces a consistent snapshot even in WAL
    // mode — a plain file copy of tandem.db could miss data still in the -wal.
    await db.backup(filePath)
    return reply.send({ path: filePath })
  })
}
