import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { promises as fs } from 'fs'
import path from 'path'
import type { Config } from '../config'

// A timestamp safe for filenames on every OS: no colons. 2026-07-19_14-30-05.
function stamp(): string {
  const iso = new Date().toISOString().slice(0, 19) // 2026-07-19T14:30:05
  return iso.replace('T', '_').replace(/:/g, '-')
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
