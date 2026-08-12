import { FastifyInstance, FastifyRequest } from 'fastify'

// What the operator is looking for. Two kinds, because a directory and the
// club's voucher list need different Windows dialogs.
export type PickKind = 'directory' | 'excel-file'

// Opens a dialog on the desktop of the machine running the server and resolves
// with the chosen path, or with null if the operator cancelled. Injected, so
// that tests never spawn a real dialog and a non-Windows build simply has none.
export type PickPath = (kind: PickKind, current: string) => Promise<string | null>

const KINDS: readonly string[] = ['directory', 'excel-file']

// The dialog appears on the host's own desktop. Someone on a tablet who pressed
// the button would see nothing and wait for a dialog only the host could answer,
// so the picker exists for local callers only. This has to be decided here and
// not in the manifest: the hidden `apiBase` setting lets the manifest talk to a
// different machine, so "my browser says localhost" proves nothing.
function isLocal(req: FastifyRequest): boolean {
  return req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1'
}

export function registerPickPathRoutes(app: FastifyInstance, pickPath?: PickPath) {
  // One dialog at a time. There is a single desktop and a single operator in
  // front of it; a second click while one is open used to stack another dialog
  // behind the first, and every one of them had to be answered separately.
  let dialogOpen = false

  app.get('/api/pick-path', async (req) => ({ available: !!pickPath && isLocal(req) }))

  app.post('/api/pick-path', async (req, reply) => {
    if (!isLocal(req)) {
      reply.code(403)
      return { error: 'Dateiauswahl nur am Rechner mit tandem.exe möglich' }
    }
    if (!pickPath) {
      reply.code(503)
      return { error: 'Dateiauswahl auf diesem System nicht verfügbar' }
    }
    const body = (req.body as any) ?? {}
    if (!KINDS.includes(body.kind)) {
      reply.code(400)
      return { error: 'kind ungültig' }
    }
    if (dialogOpen) {
      reply.code(409)
      return { error: 'Es ist bereits ein Auswahlfenster offen' }
    }
    const current = typeof body.current === 'string' ? body.current : ''
    dialogOpen = true
    try {
      return { path: await pickPath(body.kind as PickKind, current) }
    } finally {
      // Also on a crashed dialog — otherwise one failure locks the button for
      // the rest of the day.
      dialogOpen = false
    }
  })
}
