import { test, expect, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import os from 'os'
import path from 'path'
import { loadConfig, saveConfig, withBoldMarkers, DEFAULT_PAYOUTS, DEFAULT_PRICES } from '../src/server/config'

const tmpDirs: string[] = []

async function makeDir(configJson?: unknown) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tandem-config-test-'))
  tmpDirs.push(dir)
  if (configJson !== undefined) {
    await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify(configJson))
  }
  return dir
}

afterEach(async () => {
  while (tmpDirs.length) await fs.rm(tmpDirs.pop()!, { recursive: true, force: true })
})

test('a missing config.json falls back to the default price table', async () => {
  const dir = await makeDir()
  expect(loadConfig(dir).prices).toEqual(DEFAULT_PRICES)
})

test('a config.json written before prices existed gains the defaults', async () => {
  const dir = await makeDir({ exportDir: 'D:/Tandem', jumpLocation: 'Freistadt' })
  const cfg = loadConfig(dir)
  expect(cfg.exportDir).toBe('D:/Tandem')
  expect(cfg.prices).toEqual(DEFAULT_PRICES)
})

test('a partial price block keeps the stored amounts and fills the rest', async () => {
  const dir = await makeDir({ prices: { jump: 290 } })
  const cfg = loadConfig(dir)
  expect(cfg.prices.jump).toBe(290)
  expect(cfg.prices.weight_over_100).toBe(60)
})

test('a missing config.json falls back to the default payout rates', async () => {
  const dir = await makeDir()
  expect(loadConfig(dir).payouts).toEqual(DEFAULT_PAYOUTS)
})

test('a config.json written before payouts existed gains the defaults', async () => {
  const dir = await makeDir({ exportDir: 'D:/Tandem', prices: { jump: 290 } })
  const cfg = loadConfig(dir)
  expect(cfg.prices.jump).toBe(290)
  expect(cfg.payouts).toEqual(DEFAULT_PAYOUTS)
})

test('a partial payout block keeps the stored rates and fills the rest', async () => {
  const dir = await makeDir({ payouts: { tandem_master: 50 } })
  const cfg = loadConfig(dir)
  expect(cfg.payouts.tandem_master).toBe(50)
  expect(cfg.payouts.video_photo).toBe(80)
})

test('the payout defaults carry the tandemmaster weight bonus', async () => {
  const dir = await makeDir()
  const cfg = loadConfig(dir)
  expect(cfg.payouts.weight_over_90).toBe(15)
  expect(cfg.payouts.weight_over_100).toBe(25)
})

test('a payout block written before the weight bonus existed gains it', async () => {
  const dir = await makeDir({ payouts: { tandem_master: 50, video: 60, video_photo: 80 } })
  const cfg = loadConfig(dir)
  expect(cfg.payouts.tandem_master).toBe(50)
  expect(cfg.payouts.weight_over_90).toBe(15)
  expect(cfg.payouts.weight_over_100).toBe(25)
})

test('prices survive a save/load round trip', async () => {
  const dir = await makeDir()
  const cfg = loadConfig(dir)
  cfg.prices.jump = 300
  saveConfig(dir, cfg)
  expect(loadConfig(dir).prices.jump).toBe(300)
})

test('the default Vertragstext carries the bold markers the paper contract prints', async () => {
  const dir = await makeDir()
  expect(loadConfig(dir).contractText).toContain('**Absprung:**')
  expect(loadConfig(dir).contractText).toContain('**Freier Fall:**')
})

test('a Vertragstext written before the markers gets them on load', async () => {
  // What every existing installation has on disk: the old default, unmarked.
  const dir = await makeDir({
    contractText: 'Einweisung:\nAbsprung: Hohlkreuz\nFreier Fall: atmen',
  })
  expect(loadConfig(dir).contractText).toBe(
    'Einweisung:\n**Absprung:** Hohlkreuz\n**Freier Fall:** atmen'
  )
})

test('a text that already carries markers is left exactly as it is', () => {
  // Including a club that deliberately un-bolded one of the old passages: once
  // there are markers, the markers are the whole truth.
  const text = 'Absprung: schlicht\n**Freier Fall:** fett'
  expect(withBoldMarkers(text)).toBe(text)
})

test('a text without any of the known passages is left alone', () => {
  expect(withBoldMarkers('Ein ganz eigener Vertrag.')).toBe('Ein ganz eigener Vertrag.')
})

test('the Datenschutztext is not marked up behind the club back', async () => {
  const dir = await makeDir({ privacyText: 'Absprung: steht hier zufaellig' })
  expect(loadConfig(dir).privacyText).toBe('Absprung: steht hier zufaellig')
})
