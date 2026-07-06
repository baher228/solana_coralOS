import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))
export const DATA_DIR = fileURLToPath(new URL('../.data/', import.meta.url))
export const DATA_FILE = `${DATA_DIR}jobs.json`
export const AGENTS_FILE = `${DATA_DIR}agents.json`
export const REVIEW_DIR = `${DATA_DIR}reviews`
export const PORT = Number(process.env.PORT ?? 8801)
export const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'
export const BALANCE_TIMEOUT_MS = 2500
export const REVIEW_TIMEOUT_MS = Number(process.env.REVIEW_TIMEOUT_MS ?? 90000)
export const AUTO_RELEASE_MS = Number(process.env.AUTO_RELEASE_MS ?? 72 * 60 * 60 * 1000)
export const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? 72 * 60 * 60)
export const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? 30_000)
export const CORAL_BUS_API = process.env.CORAL_BUS_API ?? 'http://localhost:8001'
export const MAX_LOG_CHARS = 6000
export const MAX_SNIPPET_CHARS = 2000

export async function loadEnv() {
  try {
    for (const line of (await fs.readFile(ENV_PATH, 'utf8')).split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    // No secrets by default. Run node scripts/setup.js to create local devnet keys.
  }
}
