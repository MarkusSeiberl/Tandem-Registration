import Fastify, { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { SseHub } from './sse'
import { registerRegistrationRoutes } from './routes/registrations'
import { registerStammdatenRoutes } from './routes/stammdaten'
import { registerExportRoutes } from './routes/export'
import { registerDayManagerRoutes } from './routes/dayManager'
import { registerShutdownRoutes } from './routes/shutdown'
import { registerUpdateRoutes } from './routes/update'
import type { UpdateControls } from './routes/update'
import { registerSettingsRoutes } from './routes/settings'
import { registerBackupRoutes } from './routes/backup'
import { registerVoucherRoutes } from './routes/voucher'
import { registerPickPathRoutes } from './routes/pickPath'
import { registerPathRoutes } from './routes/paths'
import type { PickPath } from './routes/pickPath'
import type { Config } from './config'

export function buildServer(
  db: Database,
  cfgRef: { current: Config },
  contractTemplate: Buffer,
  persist?: (c: Config) => void,
  notify?: (guestName: string) => void,
  pickPath?: PickPath,
  // Only the packaged exe passes this: it is the one build that owns its own
  // process and can end it cleanly (see main.ts).
  shutdown?: () => void,
  // Likewise: the one build that owns the files it runs from.
  update?: UpdateControls,
): FastifyInstance {
  const app = Fastify({ bodyLimit: 5 * 1024 * 1024 }) // signatures
  const sse = new SseHub()
  app.get('/api/health', async () => ({ ok: true }))
  // Unlike /api/contract (registered in main.ts) this lives here, so the tests
  // that build a server without main.ts can reach it.
  app.get('/api/privacy', async () => ({ text: cfgRef.current.privacyText }))
  registerRegistrationRoutes(app, db, sse, cfgRef, contractTemplate, notify)
  registerStammdatenRoutes(app, db)
  registerExportRoutes(app, db, cfgRef)
  registerDayManagerRoutes(app, db)
  registerBackupRoutes(app, db, cfgRef)
  registerSettingsRoutes(app, cfgRef, persist)
  registerVoucherRoutes(app, db, cfgRef)
  registerPickPathRoutes(app, pickPath)
  registerPathRoutes(app)
  registerShutdownRoutes(app, shutdown)
  registerUpdateRoutes(app, db, update)
  // The manifest's update screen redraws from this instead of polling a
  // 114 MB download's progress over HTTP.
  update?.state.onChange((status) => sse.broadcast('update', status))
  return app
}
