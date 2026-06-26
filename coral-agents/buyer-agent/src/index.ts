/**
 * Buyer agent — the marketplace buyer. Broadcasts a WANT into a shared CoralOS thread, collects
 * competing LLM bids, picks the best value, and settles through the escrow contract:
 *
 *   WANT → (collect BIDs for a window) → AWARD winner → wait ESCROW_REQUIRED →
 *   deposit() into escrow → DEPOSITED → wait DELIVERED → release() to the seller
 *
 * Selection uses the LLM (best value), with a deterministic cheapest fallback so a slow/missing model
 * never hangs the round. Settlement is escrow-only — funds are conditional on delivery.
 *
 * Env: BUYER_KEYPAIR_B58 (signs), BUYER_MAX_SOL (budget), BUYER_SERVICE/BUYER_ARG (the WANT),
 *      MARKET_SELLERS (csv of seller names), BID_WINDOW_MS, SOLANA_RPC_URL,
 *      ANTHROPIC_API_KEY|OPENAI_API_KEY (+ LLM_PROVIDER), TRACE=1.
 *
 * TYPECHECK-ONLY: the deposit/release calls require a deployed escrow program + a funded devnet
 * wallet to actually run.
 */
import {
  startCoralAgent, complete, parseJsonReply, loadKeypairB58,
  formatWant, parseBid, parseEscrowRequired, formatAward, formatDeposited,
  selectBids, pickCheapest, verb, messageRound,
  type Bid, type EscrowTerms, type CoralAgentContext,
} from '@pay/agent-runtime'
import { PublicKey } from '@solana/web3.js'
import { makeProgram, deposit, release, escrowPda } from './escrow.js'

const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const BUDGET = Number(process.env.BUYER_MAX_SOL ?? '0.001')
const SERVICE = process.env.BUYER_SERVICE ?? 'jupiter'
const ARG = process.env.BUYER_ARG ?? 'SOL-USDC'
const BID_WINDOW_MS = Number(process.env.BID_WINDOW_MS ?? '5000')
const CYCLE_MS = Number(process.env.CYCLE_INTERVAL_MS ?? '30000')
const SELLERS = (process.env.MARKET_SELLERS ?? 'seller-cheap,seller-premium')
  .split(',').map((s) => s.trim()).filter(Boolean)
const trace = process.env.TRACE === '1'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

/** Best-value selection via LLM; deterministic cheapest fallback. Returns the winner + its reasoning. */
async function pickWinner(pool: Bid[]): Promise<{ winner: Bid; reason?: string }> {
  if (pool.length === 1) return { winner: pool[0] }
  try {
    const system =
      'You are a buyer choosing the best-value bid for a Solana data service. ' +
      'Reply ONLY with JSON {"by": "<seller name>", "reason": "<short>"}.'
    const user =
      `service=${SERVICE} arg=${ARG} budget=${BUDGET}\nbids:\n` +
      pool.map((b) => `- ${b.by}: ${b.priceSol} SOL${b.note ? ` (${b.note})` : ''}`).join('\n')
    const parsed = parseJsonReply<{ by?: string; reason?: string }>(await complete({ system, user, maxTokens: 100 }))
    const chosen = pool.find((b) => b.by === parsed?.by)
    if (chosen) {
      console.error(`[buyer] picked ${chosen.by} (${chosen.priceSol} SOL): ${parsed?.reason ?? ''}`)
      return { winner: chosen, reason: parsed?.reason }
    }
  } catch {
    /* fall through to deterministic choice */
  }
  return { winner: pickCheapest(pool)!, reason: 'cheapest available' }
}

/** Wait (bounded) for a message matching `round` that `parse` accepts. */
async function waitFor<T>(
  ctx: CoralAgentContext,
  round: number,
  parse: (text: string) => (T & { round: number }) | null,
  maxMs: number,
): Promise<T | null> {
  const deadline = Date.now() + maxMs
  while (Date.now() < deadline) {
    const m = await ctx.waitForMention(Math.max(500, deadline - Date.now()))
    if (!m) continue
    const parsed = parse(m.text)
    if (parsed && parsed.round === round) return parsed
  }
  return null
}

await startCoralAgent({ agentName: process.env.AGENT_NAME ?? 'buyer-agent' }, async (ctx) => {
  const buyer = loadKeypairB58('BUYER_KEYPAIR_B58')
  console.error(`[buyer] market buyer — wallet=${buyer.publicKey.toBase58()} budget=${BUDGET} sellers=[${SELLERS.join(',')}]`)

  for (const s of SELLERS) {
    try { await ctx.waitForAgent(s, 8000) } catch { /* seller may already be present */ }
  }
  const thread = await ctx.createThread('market', SELLERS)
  const program = await makeProgram(buyer, RPC)
  let round = 0

  while (true) {
    try {
      round++
      if (trace) console.error(`[buyer] round ${round}: WANT ${SERVICE} ${ARG} budget=${BUDGET}`)
      await ctx.send(formatWant({ round, service: SERVICE, arg: ARG, budgetSol: BUDGET }), thread, SELLERS)

      // ── collect competing bids during the window ──────────────────────────
      const bids: Bid[] = []
      const deadline = Date.now() + BID_WINDOW_MS
      while (Date.now() < deadline) {
        const m = await ctx.waitForMention(Math.max(500, deadline - Date.now()))
        if (!m) continue
        const b = parseBid(m.text)
        if (b && b.round === round) bids.push(b)
      }
      const pool = selectBids(bids, round)
      if (pool.length === 0) { console.error(`[buyer] round ${round}: NO_SELLERS`); await sleep(CYCLE_MS); continue }

      // ── award the best value ──────────────────────────────────────────────
      const { winner, reason } = await pickWinner(pool)
      await ctx.send(formatAward(round, winner.by, reason), thread, [winner.by])

      // ── settle through escrow: deposit → DEPOSITED → wait DELIVERED → release
      const terms = await waitFor<EscrowTerms>(ctx, round, parseEscrowRequired, 15_000)
      if (!terms) { console.error(`[buyer] round ${round}: no escrow terms from ${winner.by}`); await sleep(CYCLE_MS); continue }

      const reference = new PublicKey(terms.reference)
      const seller = new PublicKey(terms.seller)
      const depositSig = await deposit(program, buyer, seller, reference, terms.amountSol, terms.deadlineSecs)
      console.error(`[buyer] round ${round}: DEPOSITED ${terms.amountSol} SOL → ${winner.by}`)
      if (trace) {
        console.error(`[buyer]   escrow PDA: ${expl('address', escrowPda(buyer.publicKey, reference).toBase58())}`)
        console.error(`[buyer]   deposit tx: ${expl('tx', depositSig)}`)
      }
      await ctx.send(
        formatDeposited({ round, reference: terms.reference, buyer: buyer.publicKey.toBase58(), sig: depositSig }),
        thread, [winner.by],
      )

      const delivered = await waitFor(ctx, round, (t) => {
        const r = messageRound(t)
        return verb(t) === 'DELIVERED' && r != null ? { round: r } : null
      }, 30_000)

      if (delivered) {
        const releaseSig = await release(program, buyer, seller, reference)
        console.error(`[buyer] round ${round}: RELEASED to ${winner.by} — ${expl('tx', releaseSig)}`)
        await ctx.send(`RELEASED round=${round} sig=${releaseSig}`, thread, [winner.by])
      } else {
        console.error(`[buyer] round ${round}: no delivery — funds stay in escrow, refundable after the deadline`)
      }
    } catch (e) {
      console.error(`[buyer] round error: ${e}`)
    }
    await sleep(CYCLE_MS)
  }
})
