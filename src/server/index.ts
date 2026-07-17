import Fastify, { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { SseHub } from './sse'
import { registerRegistrationRoutes } from './routes/registrations'
import { registerStammdatenRoutes } from './routes/stammdaten'
import { registerExportRoutes } from './routes/export'
import { registerSettingsRoutes } from './routes/settings'
import type { Config } from './config'

export function buildServer(
  db: Database,
  cfgRef: { current: Config },
  contractTemplate: Buffer,
  persist?: (c: Config) => void
): FastifyInstance {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 }) // signatures
  const sse = new SseHub()
  app.get('/api/health', async () => ({ ok: true }))
  registerRegistrationRoutes(app, db, sse, cfgRef, contractTemplate)
  registerStammdatenRoutes(app, db)
  registerExportRoutes(app, db, () => cfgRef.current.exportDir)
  registerSettingsRoutes(app, cfgRef, persist)
  return app
}
