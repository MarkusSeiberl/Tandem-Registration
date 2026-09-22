import { FastifyInstance } from 'fastify'
import type { Database } from 'better-sqlite3'
import { APP_VERSION } from '../version'
import { today } from '../day'
import type { UpdateState, UpdateStatus } from '../update/state'

/**
 * What the routes are allowed to set in motion. Only the packaged exe hands
 * this in — it is the one build that owns its own files and its own process.
 */
export interface UpdateControls {
  state: UpdateState
  /** All three answer immediately and do their work afterwards. */
  check: () => void
  download: () => void
  install: () => void
}

export interface UpdateStatusResponse extends UpdateStatus {
  allowed: boolean
  promptPending: boolean
  openToday: number
}

// Same reasoning as routes/shutdown.ts: the manifest has no login and every
// device on the club WLAN can open it, so the server decides. `req.ip` is the
// socket's peer address — nothing a client can set about itself.
function isLocal(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

function openToday(db: Database): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM registrations WHERE jump_date = ? AND paid_at IS NULL')
    .get(today()) as { n: number }
  return row.n
}

export function registerUpdateRoutes(
  app: FastifyInstance,
  db: Database,
  update?: UpdateControls,
): void {
  app.get('/api/update/status', async (req): Promise<UpdateStatusResponse> => {
    const base: UpdateStatus = update
      ? update.state.get()
      : {
          phase: 'disabled', currentVersion: APP_VERSION, latestVersion: null,
          notes: null, downloadedBytes: 0, totalBytes: 0, error: null, checkedAt: null,
        }
    return {
      ...base,
      allowed: update !== undefined && isLocal(req.ip),
      // A getter on UpdateState, not on UpdateControls.
      promptPending: update?.state.promptPending ?? false,
      openToday: openToday(db),
    }
  })

  // The four actions share one gate, so a new one cannot forget it.
  function action(url: string, run: (c: UpdateControls) => void, code: number) {
    app.post(url, async (req, reply) => {
      if (!update) {
        return reply.code(501).send({ error: 'Updates sind auf diesem Server nicht eingerichtet.' })
      }
      if (!isLocal(req.ip)) {
        return reply.code(403).send({
          error: 'Updates sind nur an dem Rechner möglich, auf dem Tandem läuft.',
        })
      }
      reply.code(code).send(code === 204 ? undefined : { ok: true })
      run(update)
    })
  }

  action('/api/update/check', (c) => c.check(), 202)
  action('/api/update/download', (c) => c.download(), 202)
  action('/api/update/install', (c) => c.install(), 202)
  action('/api/update/prompt-seen', (c) => c.state.markPromptSeen(), 204)
}
