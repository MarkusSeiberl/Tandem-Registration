/**
 * Is this request from the machine the server runs on?
 *
 * The manifest has no login and any device on the club WLAN can open it, so
 * without this check one curious tablet could end the jump day for everybody
 * (or restart the server mid-registration) by hitting an update or shutdown
 * route. `ip` is `req.ip`, Fastify's read of the socket's peer address —
 * nothing a client can set about itself — and the app sets no `trustProxy`,
 * so it cannot be influenced by a request header either.
 *
 * Shared by routes/update.ts and routes/shutdown.ts so the rule cannot drift
 * between the two: two copies of one security check is how one of them ends
 * up quietly weaker than the other.
 */
export function isLocal(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}
