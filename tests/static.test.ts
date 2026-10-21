import { test, expect, afterEach } from 'vitest'
import Fastify from 'fastify'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { registerStatic } from '../src/server/static'

const tmpDirs: string[] = []

async function makeTmpDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-static-test-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tmpDirs.length) {
    await fs.rm(tmpDirs.pop()!, { recursive: true, force: true })
  }
})

async function writeApp(webRoot: string, name: string, html: string) {
  const dist = path.join(webRoot, name, 'dist')
  await fs.mkdir(dist, { recursive: true })
  await fs.writeFile(path.join(dist, 'index.html'), html)
}

// The packaged exe registers the routes on an empty temp folder and only
// extracts the embedded frontends once the port is bound (main.ts). A fresh
// %TEMP% must not leave /guest and /manifest unrouted.
test('serves frontends extracted after registration into an empty web root', async () => {
  const webRoot = await makeTmpDir()
  const app = Fastify()
  registerStatic(app, webRoot)
  await app.ready()

  await writeApp(webRoot, 'guest', '<p>guest</p>')
  await writeApp(webRoot, 'manifest', '<p>manifest</p>')

  const guest = await app.inject({ method: 'GET', url: '/guest/' })
  expect(guest.statusCode).toBe(200)
  expect(guest.body).toContain('guest')

  const manifest = await app.inject({ method: 'GET', url: '/manifest/' })
  expect(manifest.statusCode).toBe(200)
  expect(manifest.body).toContain('manifest')

  await app.close()
})

test('serves frontends that are already built at registration', async () => {
  const webRoot = await makeTmpDir()
  await writeApp(webRoot, 'guest', '<p>guest</p>')
  await writeApp(webRoot, 'manifest', '<p>manifest</p>')
  const app = Fastify()
  registerStatic(app, webRoot)

  expect((await app.inject({ method: 'GET', url: '/guest/' })).statusCode).toBe(200)
  expect((await app.inject({ method: 'GET', url: '/manifest/' })).statusCode).toBe(200)

  await app.close()
})
