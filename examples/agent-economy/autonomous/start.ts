/**
 * Autonomous path starter — kicks off the agent↔agent economy on CoralOS.
 *
 * coral-server launches agents *per session*, so the autonomous buyer↔seller loop begins the
 * moment a session naming both is created. This script creates that session, then tails the
 * shared thread so you can watch the loop settle (request → PAYMENT_REQUIRED → on-chain pay →
 * DELIVERED) without `docker logs`.
 *
 *   CORAL_SERVER_URL  default http://localhost:5555
 *   CORAL_TOKEN       default dev   (must be in coral.toml [auth] keys)
 *
 * Run from the host after `docker compose up coral`:  npx tsx start.ts
 */
const BASE = process.env.CORAL_SERVER_URL ?? 'http://localhost:5555'
const TOKEN = process.env.CORAL_TOKEN ?? 'dev'
const NS = 'default'
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

const localAgent = (name: string) => ({
  id: { name, version: '0.1.0', registrySourceId: { type: 'local' } },
  name,
  provider: { type: 'local', runtime: 'docker' },
})

async function main() {
  // Create a session with both agents — coral spawns their containers and connects them.
  const sres = await fetch(`${BASE}/api/v1/local/session`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({
      agentGraphRequest: { agents: [localAgent('buyer-agent'), localAgent('seller-agent')] },
      namespaceProvider: { type: 'create_if_not_exists', namespaceRequest: { name: NS } },
      execution: { mode: 'immediate' },
    }),
  })
  if (!sres.ok) throw new Error(`session create failed: ${sres.status} ${await sres.text()}`)
  const { sessionId } = await sres.json() as { sessionId: string }

  console.log(`\n✅ Session ${sessionId} created with [buyer-agent, seller-agent].`)
  console.log('   The buyer will open a thread and start its purchase loop.\n')
  console.log('   Watch it settle:')
  console.log('     docker logs -f buyer-agent     # "paying memo=…" → "received data"')
  console.log('     docker logs -f seller-agent    # "payment verified — delivering service"')
  console.log('   Each payment is a real devnet tx — paste the sig into explorer.solana.com (?cluster=devnet).\n')
}

main().catch((e) => { console.error(`[autonomous] ${e}`); process.exitCode = 1 })
