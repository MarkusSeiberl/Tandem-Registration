import { test, expect, vi } from 'vitest'
import { testServer } from './helpers/testServer'

// A LAN address: a tablet, a phone, anything that can open the manifest.
const REMOTE = '192.168.0.42'

// Only the packaged exe knows how to stop itself; a server built without that
// is the dev/e2e case, and it must not pretend the button works.
const serverThatCanStop = (shutdown: () => void) =>
  testServer({}, undefined, undefined, shutdown)

test('the button is offered on the machine the server runs on', async () => {
  const { app } = serverThatCanStop(vi.fn())
  const res = await app.inject({ method: 'GET', url: '/api/shutdown-allowed' })
  expect(res.json()).toEqual({ allowed: true })
  await app.close()
})

test('the button is not offered to a device on the network', async () => {
  const { app } = serverThatCanStop(vi.fn())
  const res = await app.inject({
    method: 'GET', url: '/api/shutdown-allowed', remoteAddress: REMOTE,
  })
  expect(res.json()).toEqual({ allowed: false })
  await app.close()
})

test('a server started without a way to stop itself offers nothing', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'GET', url: '/api/shutdown-allowed' })
  expect(res.json()).toEqual({ allowed: false })
  await app.close()
})

test('the local machine can stop the server', async () => {
  const shutdown = vi.fn()
  const { app } = serverThatCanStop(shutdown)
  const res = await app.inject({ method: 'POST', url: '/api/shutdown' })
  expect(res.statusCode).toBe(202)
  // Answered first, stopped after — the browser has to hear that it worked
  // before the server it is talking to goes away.
  await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1))
  await app.close()
})

// One tablet on the WLAN must not be able to end the day for everyone else.
test('a device on the network cannot stop the server', async () => {
  const shutdown = vi.fn()
  const { app } = serverThatCanStop(shutdown)
  const res = await app.inject({ method: 'POST', url: '/api/shutdown', remoteAddress: REMOTE })
  expect(res.statusCode).toBe(403)
  expect(shutdown).not.toHaveBeenCalled()
  await app.close()
})

test('an IPv6 loopback client is the local machine too', async () => {
  const shutdown = vi.fn()
  const { app } = serverThatCanStop(shutdown)
  const res = await app.inject({ method: 'POST', url: '/api/shutdown', remoteAddress: '::1' })
  expect(res.statusCode).toBe(202)
  await vi.waitFor(() => expect(shutdown).toHaveBeenCalledTimes(1))
  await app.close()
})

test('a server started without a way to stop itself says so', async () => {
  const { app } = testServer()
  const res = await app.inject({ method: 'POST', url: '/api/shutdown' })
  expect(res.statusCode).toBe(501)
  await app.close()
})
