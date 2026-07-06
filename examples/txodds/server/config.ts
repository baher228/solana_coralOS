import { readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))

function applyEnv(contents: string): void {
  for (const line of contents.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

try {
  applyEnv(readFileSync(ENV_PATH, 'utf8'))
} catch {
  // No secrets by default. Run node scripts/setup.js to create local devnet keys.
}

const liveDataDir = fileURLToPath(new URL('../.data/', import.meta.url))
const testDataDir = fileURLToPath(new URL('../.data-test/', import.meta.url))
export const DATA_DIR = process.env.TXODDS_DATA_DIR
  ? `${path.resolve(process.env.TXODDS_DATA_DIR)}${path.sep}`
  : process.env.VITEST
    ? testDataDir
    : liveDataDir
export const DATA_FILE = `${DATA_DIR}jobs.json`
export const AGENTS_FILE = `${DATA_DIR}agents.json`
export const REVIEW_DIR = `${DATA_DIR}reviews`
export const PORT = Number(process.env.PORT ?? 8801)
export const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)))
export const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, '')
export const INTERNAL_API_BASE = (process.env.PLATFORM_API_URL || `http://127.0.0.1:${PORT}`).replace(/\/+$/, '')
export const DEFAULT_RPC_URL = 'https://api.devnet.solana.com'
export const BALANCE_TIMEOUT_MS = 2500
export const REVIEW_TIMEOUT_MS = Number(process.env.REVIEW_TIMEOUT_MS ?? 90000)
export const AUTO_RELEASE_MS = Number(process.env.AUTO_RELEASE_MS ?? 72 * 60 * 60 * 1000)
export const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? 72 * 60 * 60)
export const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? 30_000)
export const CORAL_BUS_API = process.env.CORAL_BUS_API ?? 'http://localhost:8001'
export const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
export const DEMO_PUBLIC_PREVIEW_BASE_URL = (process.env.DEMO_PUBLIC_PREVIEW_BASE_URL || '').replace(/\/+$/, '')
export const DEMO_DELIVERY_DIR = process.env.DEMO_DELIVERY_DIR || ''
export const DEMO_SESSION_TTL_MS = Number(process.env.DEMO_SESSION_TTL_MS ?? 60 * 60 * 1000)
export const DEMO_MAX_WORKERS = Number(process.env.DEMO_MAX_WORKERS ?? 2)
export const MAX_LOG_CHARS = 6000
export const MAX_SNIPPET_CHARS = 2000

export function publicUrl(pathname = ''): string {
  return `${PUBLIC_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

export function corsOrigin(origin?: string): string | undefined {
  if (!origin) return CORS_ALLOWED_ORIGINS.length ? undefined : '*'
  if (!CORS_ALLOWED_ORIGINS.length || CORS_ALLOWED_ORIGINS.includes('*') || CORS_ALLOWED_ORIGINS.includes(origin)) return origin
  return undefined
}

export async function loadEnv() {
  try {
    applyEnv(await fs.readFile(ENV_PATH, 'utf8'))
  } catch {
    // No secrets by default. Run node scripts/setup.js to create local devnet keys.
  }
}
