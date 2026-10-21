import fs from 'fs'
import path from 'path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export function registerStatic(app: FastifyInstance, webRoot: string) {
  const guestRoot = path.join(webRoot, 'guest/dist')
  const manifestRoot = path.join(webRoot, 'manifest/dist')

  // The routes are registered even when a frontend is missing: the packaged
  // exe extracts its embedded frontends only after the port is bound (see
  // main.ts), so on a fresh %TEMP% the folders do not exist yet. Files are
  // looked up per request, so whatever lands there later is served.
  // @fastify/static needs its root to exist, hence the mkdir.
  for (const root of [guestRoot, manifestRoot]) {
    if (!fs.existsSync(root)) {
      console.warn(`[static] ${root} is missing (frontend not built or not extracted yet)`)
      fs.mkdirSync(root, { recursive: true })
    }
  }

  app.register(fastifyStatic, {
    root: guestRoot,
    prefix: '/guest',
    redirect: true
  })

  app.register(fastifyStatic, {
    root: manifestRoot,
    prefix: '/manifest',
    decorateReply: false,
    redirect: true
  })

  // The guest app is the default: the tablet handed to a customer should open
  // straight into the registration form. Staff reach the manifest via /manifest.
  app.get('/', async (_req, reply) => {
    reply.redirect('/guest')
  })
}
