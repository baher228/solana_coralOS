import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

export const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))

function loadEnv(): void {
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {
    /* no .env - rely on shell env */
  }
}

loadEnv()

export const RPC = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
export const PORT = Number(process.env.PORT ?? 8801)
export const ESCROW_ACCOUNT_SPACE = 121

export const explorerLink = (kind: 'tx' | 'address', id: string): string =>
  `https://explorer.solana.com/${kind}/${id}?cluster=devnet`
