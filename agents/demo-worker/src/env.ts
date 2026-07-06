import fs from 'node:fs/promises'
import { ROOT_ENV } from './config.ts'

export async function loadRootEnv(file = ROOT_ENV) {
  try {
    for (const line of (await fs.readFile(file, 'utf8')).split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // Fresh demo checkouts may not have .env yet.
  }
}
