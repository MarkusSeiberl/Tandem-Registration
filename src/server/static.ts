import fs from 'fs'
import path from 'path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export function registerStatic(app: FastifyInstance, webRoot: string) {
  const guestRoot = path.join(webRoot, 'guest/dist')
  const manifestRoot = path.join(webRoot, 'manifest/dist')

  if (fs.existsSync(guestRoot)) {
    app.register(fastifyStatic, {
      root: guestRoot,
      prefix: '/guest',
      redirect: true
    })
  } else {
    console.warn(`[static] guest app not built yet, skipping /guest static route (missing ${guestRoot})`)
  }

  if (fs.existsSync(manifestRoot)) {
    app.register(fastifyStatic, {
      root: manifestRoot,
      prefix: '/manifest',
      decorateReply: false,
      redirect: true
    })
  } else {
    console.warn(`[static] manifest app not built yet, skipping /manifest static route (missing ${manifestRoot})`)
  }

  app.get('/', async (_req, reply) => {
    reply.redirect('/manifest')
  })
}
