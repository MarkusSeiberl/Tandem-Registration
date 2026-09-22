import { FastifyInstance } from 'fastify'
import { isLocal } from './isLocal'

/**
 * Stopping the program from the manifest screen.
 *
 * The operator's alternative is closing a console window they never look at, or
 * Strg+C in it — so the screen they do work on gets a button. It ends the server
 * for everyone: guest tablets included, mid-registration included, which is why
 * the manifest asks before calling this.
 *
 * Only from the machine the server runs on — see isLocal.ts for why.
 */
export function registerShutdownRoutes(app: FastifyInstance, shutdown?: () => void) {
  // The manifest asks before it draws the button: a client that cannot use it
  // should say so instead of offering an action that answers 403.
  app.get('/api/shutdown-allowed', async (req) => ({
    allowed: shutdown !== undefined && isLocal(req.ip),
  }))

  app.post('/api/shutdown', async (req, reply) => {
    // Only the packaged exe hands in a way to stop itself. A dev `npm start` or
    // the e2e run is stopped by whoever started it.
    if (!shutdown) {
      return reply.code(501).send({ error: 'Beenden ist auf diesem Server nicht eingerichtet.' })
    }
    if (!isLocal(req.ip)) {
      return reply.code(403).send({
        error: 'Beenden ist nur an dem Rechner möglich, auf dem Tandem läuft.',
      })
    }
    // Answer first, stop after: the browser has to hear that it worked before
    // the server it is talking to disappears. `unref` keeps the timer from
    // holding a test process open.
    reply.code(202).send({ ok: true })
    setTimeout(shutdown, 50).unref?.()
  })
}
