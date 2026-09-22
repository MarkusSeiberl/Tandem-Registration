import { test, expect, vi } from 'vitest'
import { testServer } from './helpers/testServer'
import { UpdateState } from '../src/server/update/state'
import type { UpdateControls } from '../src/server/routes/update'

const REMOTE = '192.168.0.42'

function withUpdate(state = new UpdateState('1.1.0')) {
  const controls: UpdateControls = {
    state, check: vi.fn(), download: vi.fn(), install: vi.fn(),
  }
  return { ...testServer({}, undefined, undefined, undefined, controls), controls, state }
}

test('the status names both versions and is open to every device', async () => {
  const state = new UpdateState('1.1.0')
  state.patch({ phase: 'available', latestVersion: '1.2.0', notes: '## Neu' })
  const { app } = withUpdate(state)
  const res = await app.inject({ method: 'GET', url: '/api/update/status', remoteAddress: REMOTE })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toMatchObject({
    phase: 'available', currentVersion: '1.1.0', latestVersion: '1.2.0', allowed: false,
  })
  await app.close()
})

test('only the machine the server runs on is allowed to act', async () => {
  const { app } = withUpdate()
  const local = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(local.json().allowed).toBe(true)
  await app.close()
})

test('a dev server reports itself disabled and refuses every action', async () => {
  const { app } = testServer()
  const status = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(status.json()).toMatchObject({ phase: 'disabled', allowed: false })
  for (const url of ['/api/update/check', '/api/update/download', '/api/update/install']) {
    const res = await app.inject({ method: 'POST', url })
    expect(res.statusCode).toBe(501)
  }
  await app.close()
})

test('a tablet cannot start a download', async () => {
  const { app, controls } = withUpdate()
  const res = await app.inject({
    method: 'POST', url: '/api/update/download', remoteAddress: REMOTE,
  })
  expect(res.statusCode).toBe(403)
  expect(controls.download).not.toHaveBeenCalled()
  await app.close()
})

test('the local machine starts check, download and install', async () => {
  const { app, controls } = withUpdate()
  for (const [url, fn] of [
    ['/api/update/check', controls.check],
    ['/api/update/download', controls.download],
    ['/api/update/install', controls.install],
  ] as const) {
    const res = await app.inject({ method: 'POST', url })
    expect(res.statusCode).toBe(202)
    expect(fn).toHaveBeenCalledTimes(1)
  }
  await app.close()
})

test('the dialog is pending once, then never again', async () => {
  const state = new UpdateState('1.1.0')
  state.foundRelease(
    {
      version: '1.2.0', notes: '',
      exe: { name: 'tandem.exe', url: 'u', size: 1, sha256: 'a'.repeat(64) },
      native: { name: 'better_sqlite3.node', url: 'u', size: 1, sha256: 'b'.repeat(64) },
    },
    true,
  )
  const { app } = withUpdate(state)
  expect((await app.inject({ method: 'GET', url: '/api/update/status' })).json().promptPending)
    .toBe(true)
  expect((await app.inject({ method: 'POST', url: '/api/update/prompt-seen' })).statusCode)
    .toBe(204)
  expect((await app.inject({ method: 'GET', url: '/api/update/status' })).json().promptPending)
    .toBe(false)
  await app.close()
})

// The restart warning has to name a number, and stitching two endpoints
// together in the browser would let them disagree.
test('the status counts the open tandems of today', async () => {
  const { app, db } = withUpdate()
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  db.prepare('INSERT INTO registrations (first_name, jump_date, paid_at) VALUES (?, ?, ?)')
    .run('Offen', iso, null)
  db.prepare('INSERT INTO registrations (first_name, jump_date, paid_at) VALUES (?, ?, ?)')
    .run('Kassiert', iso, '2026-09-21T10:00:00Z')
  db.prepare('INSERT INTO registrations (first_name, jump_date, paid_at) VALUES (?, ?, ?)')
    .run('Gestern', '2000-01-01', null)
  const res = await app.inject({ method: 'GET', url: '/api/update/status' })
  expect(res.json().openToday).toBe(1)
  await app.close()
})
