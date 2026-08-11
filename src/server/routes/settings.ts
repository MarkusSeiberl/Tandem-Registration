import { FastifyInstance } from 'fastify'
import { PAYOUT_KEYS, PRICE_KEYS } from '../config'
import type { Config } from '../config'

// `prices` and `payouts` are both flat blocks of non-negative amounts, so they
// are validated and merged by the same rule — only the keys and the German error
// text differ.
const AMOUNT_BLOCKS = [
  { field: 'prices', keys: PRICE_KEYS, blockError: 'Preise ungültig', valueError: 'Preis' },
  { field: 'payouts', keys: PAYOUT_KEYS, blockError: 'Vergütung ungültig', valueError: 'Vergütung' },
] as const

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
    // voucherListPath must be a string if present, but empty string is valid (switches the
    // feature off). A non-string here would reach .trim() calls downstream and turn an
    // unrelated request into a 500 error.
    if ('voucherListPath' in body && typeof body.voucherListPath !== 'string') {
      reply.code(400)
      return { error: 'voucherListPath ungültig' }
    }
    for (const block of AMOUNT_BLOCKS) {
      if (!(block.field in body)) continue
      const b = body[block.field]
      if (typeof b !== 'object' || b === null || Array.isArray(b)) {
        reply.code(400)
        return { error: block.blockError }
      }
      for (const key of block.keys) {
        if (!(key in b)) continue
        if (typeof b[key] !== 'number' || !Number.isFinite(b[key]) || b[key] < 0) {
          reply.code(400)
          return { error: `${block.valueError} ${key} ungültig` }
        }
      }
    }
    // Both blocks are merged key by key. A plain spread would drop every amount
    // the caller did not send, and the manifest settings screen saves the whole
    // config object, so a stale client must not be able to wipe a new amount.
    const merged: Partial<Config> = {}
    for (const block of AMOUNT_BLOCKS) {
      merged[block.field] = block.field in body
        ? { ...cfgRef.current[block.field], ...pick(body[block.field], block.keys) } as any
        : cfgRef.current[block.field] as any
    }
    cfgRef.current = { ...cfgRef.current, ...body, ...merged }
    persist?.(cfgRef.current)
    return cfgRef.current
  })
}

function pick(source: any, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const key of keys) if (key in source) out[key] = source[key]
  return out
}
