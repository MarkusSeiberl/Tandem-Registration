import fs from 'fs'
import { FastifyInstance } from 'fastify'

// The three settings that point into the filesystem, and what has to be there.
// `jumpLocation` is a place name and no business of this route.
const PATH_FIELDS = {
  exportDir: 'directory',
  backupDir: 'directory',
  voucherListPath: 'file',
} as const

export type PathState = 'ok' | 'missing' | 'wrong-type'

// Empty counts as ok: an empty `backupDir` means "use the export directory" and
// an empty `voucherListPath` switches the voucher check off. Neither is broken.
function checkPath(value: string, want: 'directory' | 'file'): PathState {
  const p = value.trim()
  if (p === '') return 'ok'
  let stat: fs.Stats
  try {
    stat = fs.statSync(p)
  } catch {
    return 'missing'
  }
  const isDir = stat.isDirectory()
  return (want === 'directory') === isDir ? 'ok' : 'wrong-type'
}

// Advisory only. Saving a path that is not there stays allowed — it may live on
// a network share or a USB stick that is not plugged in right now, and someone
// preparing the settings in winter must not be locked out by that.
export function registerPathRoutes(app: FastifyInstance) {
  app.post('/api/paths/check', async (req, reply) => {
    const body = (req.body as any) ?? {}
    const out: Record<string, PathState> = {}
    for (const [field, want] of Object.entries(PATH_FIELDS)) {
      if (!(field in body)) continue
      if (typeof body[field] !== 'string') {
        reply.code(400)
        return { error: `${field} ungültig` }
      }
      out[field] = checkPath(body[field], want)
    }
    return out
  })
}
