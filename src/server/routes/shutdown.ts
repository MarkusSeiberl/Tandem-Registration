import { FastifyInstance } from 'fastify'

/**
 * Stopping the program from the manifest screen.
 *
 * The operator's alternative is closing a console window they never look at, or
 * Strg+C in it — so the screen they do work on gets a button. It ends the server
 * for everyone: guest tablets included, mid-registration included, which is why
 * the manifest asks before calling this.
 *
 * Only from the machine the server runs on. The manifest has no login and any
 * device on the club WLAN can open it, so without this check one curious tablet
 * could end the jump day for everybody. `req.ip` is the socket's peer address —
 * nothing a client can set about itself.
 */
function isLocal(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

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
