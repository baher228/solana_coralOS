/**
 * Marketplace starter — the headline example.
 *
 * Launches one session graph: a market buyer + three LLM seller personas. coral-server spawns each
 * as a container; the buyer broadcasts a WANT, the sellers compete with LLM bids, and the winner is
 * settled through the escrow contract. All sellers reuse the seller-agent image and share the receive
 * wallet — differentiation is persona/floor/inventory (set in each coral-agent.toml), not code.
 *
 *   CORAL_SERVER_URL  default http://localhost:5555
 *   CORAL_TOKEN       default dev   (must be in coral.toml [auth] keys)
 *
 * Run from the host after `docker compose up coral`:  npm install && npm start
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

// ── Load repo-root .env (2 levels up: marketplace → examples → root) ──
function loadEnv(): Record<string, string> {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
  const env: Record<string, string> = { ...(process.env as Record<string, string>) }
  try {
    for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on process.env */ }
  return env
}

// ── Typed coral option values ──
const str = (value: string) => ({ type: 'string', value })
const f64 = (value: number) => ({ type: 'f64', value })

const agent = (name: string, options: Record<string, unknown>) => ({
  id: { name, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
  options,
})

async function main() {
  const env = loadEnv()
  const wallet = env.WALLET
  const keypair = env.BUYER_KEYPAIR_B58
  if (!wallet || !keypair) {
    throw new Error('WALLET and BUYER_KEYPAIR_B58 must be set in .env — run `node scripts/setup.js`')
  }
  const rpc = env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
  const trace = env.TRACE ?? ''

  // LLM provider — Anthropic by default; flip the whole market with LLM_PROVIDER=openai in .env.
  const llmOpts: Record<string, unknown> = {}
  if (env.ANTHROPIC_API_KEY) llmOpts.ANTHROPIC_API_KEY = str(env.ANTHROPIC_API_KEY)
  if (env.OPENAI_API_KEY) llmOpts.OPENAI_API_KEY = str(env.OPENAI_API_KEY)
  if (env.LLM_PROVIDER) llmOpts.LLM_PROVIDER = str(env.LLM_PROVIDER)
  if (env.LLM_MODEL) llmOpts.LLM_MODEL = str(env.LLM_MODEL)
  if (trace) llmOpts.TRACE = str(trace)

  // Every seller shares the receive wallet + RPC; persona/floor/inventory come from each toml default.
  const seller = (name: string) =>
    agent(name, { SELLER_WALLET: str(wallet), SOLANA_RPC_URL: str(rpc), AGENT_NAME: str(name), ...llmOpts })

  const buyerOpts: Record<string, unknown> = {
    BUYER_KEYPAIR_B58: str(keypair),
    AGENT_NAME: str('buyer-agent'),
    SOLANA_RPC_URL: str(rpc),
    BUYER_MAX_SOL: f64(Number(env.BUYER_MAX_SOL ?? '0.001')),
    BUYER_SERVICE: str(env.BUYER_SERVICE ?? 'coingecko'),
    MARKET_SELLERS: str('seller-cheap,seller-premium,seller-lazy'),
    ...llmOpts,
  }

  const sres = await fetch(`${BASE}/api/v1/local/session`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      agentGraphRequest: {
        agents: [
          agent('buyer-agent', buyerOpts),
          seller('seller-cheap'),
          seller('seller-premium'),
          seller('seller-lazy'),
        ],
      },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = await sres.json() as { sessionId: string }

  console.log(`\n✅ Market session ${sessionId} — buyer + seller-cheap/-premium/-lazy.`)
  console.log(`   receive wallet: ${wallet}`)
  console.log('   The buyer broadcasts a WANT; sellers bid; the winner settles via escrow.\n')
  console.log('   Watch the market:')
  console.log('     docker logs -f buyer-agent      # WANT → AWARD (with a reason) → DEPOSITED → RELEASED')
  console.log('     docker logs -f seller-cheap     # BID → ESCROW_REQUIRED → DELIVERED')
  console.log('   Set TRACE=1 in .env to see the coral_* calls + Explorer links for deposit/release.\n')
}

main().catch((e) => { console.error(`[marketplace] ${e}`); process.exitCode = 1 })
