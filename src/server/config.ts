import fs from 'fs'
import path from 'path'

export interface Config {
  exportDir: string
  contractText: string
}

export function loadConfig(dir: string): Config {
  const p = path.join(dir, 'config.json')
  const def: Config = { exportDir: dir, contractText: '' }
  try {
    return { ...def, ...JSON.parse(fs.readFileSync(p, 'utf8')) }
  } catch {
    return def
  }
}

export function saveConfig(dir: string, cfg: Config) {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(cfg, null, 2))
}
