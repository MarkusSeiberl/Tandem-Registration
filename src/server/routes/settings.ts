import { FastifyInstance } from 'fastify'
import type { Config } from '../config'

export function registerSettingsRoutes(
  app: FastifyInstance,
  cfgRef: { current: Config },
  persist?: (c: Config) => void
) {
  app.get('/api/settings', async () => cfgRef.current)
  app.put('/api/settings', async (req, reply) => {
    const body = (req.body as any) ?? {}
    if ('exportDir' in body && (typeof body.exportDir !== 'string' || body.exportDir.length === 0)) {
      reply.code(400)
      return { error: 'exportDir ungültig' }
    }
    cfgRef.current = { ...cfgRef.current, ...body }
    persist?.(cfgRef.current)
    return cfgRef.current
  })
}
