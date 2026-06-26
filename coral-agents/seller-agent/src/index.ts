/**
 * Seller agent — an LLM-driven participant in the open marketplace, settling via escrow.
 *
 * Market protocol (over a shared CoralOS thread):
 * - `WANT round=… service=… arg=… budget=…`  → decide whether/at-what-price to bid (LLM, guarded);
 *                                               reply `BID …` (and remember the quote) or stay silent.
 * - `AWARD round=… to=<me>`                   → mint a reference, reply `ESCROW_REQUIRED …`.
 * - `DEPOSITED round=… reference=… buyer=… sig=…` → check the escrow is funded on-chain, then
 *                                               `deliverService` and reply `DELIVERED …`.
 *
 * The legacy 1:1 `request`/`paid` (direct-transfer) protocol is still handled for the on-ramp.
 *
 * Env: SELLER_WALLET (receive), AGENT_NAME (market identity), SERVICES/FLOOR_SOL/PERSONA (bidding),
 *      SERVICE (what deliverService returns), SOLANA_RPC_URL, ANTHROPIC_API_KEY|OPENAI_API_KEY.
 */
import {
  startCoralAgent, verb, parseWant, formatBid, parseAward, formatEscrowRequired, parseDeposited,
} from '@pay/agent-runtime'
import type { Program } from '@coral-xyz/anchor'
import { Keypair, PublicKey } from '@solana/web3.js'
import { generatePaymentUrl, verifyPayment } from './payment.js'
import { deliverService } from './service.js'
import { ReplayGuard } from './replay.js'
import { decideBid, sellerConfigFromEnv } from './bidder.js'
import { makeProgram, isFunded } from './escrow.js'

const NAME = process.env.AGENT_NAME ?? 'seller-agent'
const SELLER_WALLET = process.env.SELLER_WALLET ?? ''
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const ESCROW_DEADLINE_SECS = Number(process.env.ESCROW_DEADLINE_SECS ?? '600')
const cfg = sellerConfigFromEnv(NAME)
const trace = process.env.TRACE === '1'

interface Quote { service: string; arg: string; priceSol: number }
const quoted = new Map<number, Quote>()                 // round → what we bid
const awarded = new Map<string, { round: number } & Quote>() // reference → awaited deposit

// Legacy direct-transfer state
const pending = new Map<string, { request: string }>()
const replay = new ReplayGuard()

// Escrow program is read-only for the seller; init lazily (needs network) on first deposit.
let program: Program | null = null
const escrowProgram = async (): Promise<Program> => (program ??= await makeProgram(RPC))

await startCoralAgent({ agentName: NAME }, async (ctx) => {
  console.error(`[${NAME}] ready — services=[${cfg.services.join(',')}] floor=${cfg.floorSol} wallet=${SELLER_WALLET}`)

  while (true) {
    try {
      const mention = await ctx.waitForMention()
      if (!mention) continue
      const text = mention.text.trim()
      if (trace) console.error(`[${NAME}] ← ${text.slice(0, 140)}`)

      // ── Market: WANT → decide whether to bid ───────────────────────────────
      const want = parseWant(text)
      if (want) {
        const d = await decideBid(want, cfg)
        if (d.bid) {
          quoted.set(want.round, { service: want.service, arg: want.arg, priceSol: d.priceSol })
          await ctx.reply(mention, formatBid({ round: want.round, priceSol: d.priceSol, by: NAME, note: d.note }))
        } else if (trace) {
          console.error(`[${NAME}] no bid on round ${want.round}: ${d.note}`)
        }
        continue
      }

      // ── Market: AWARD to me → issue escrow terms for the quoted price ───────
      const award = parseAward(text)
      if (award) {
        const q = quoted.get(award.round)
        if (award.to !== NAME || !q) continue // not my win (or I never bid)
        const reference = Keypair.generate().publicKey.toBase58()
        awarded.set(reference, { round: award.round, ...q })
        quoted.delete(award.round)
        await ctx.reply(mention, formatEscrowRequired({
          round: award.round, reference, seller: SELLER_WALLET,
          amountSol: q.priceSol, deadlineSecs: ESCROW_DEADLINE_SECS,
        }))
        continue
      }

      // ── Market: DEPOSITED → verify escrow funded, then deliver ─────────────
      const dep = parseDeposited(text)
      if (dep) {
        const order = awarded.get(dep.reference)
        if (!order) { await ctx.reply(mention, `ERROR: unknown reference ${dep.reference}`); continue }
        try {
          const funded = await isFunded(
            await escrowProgram(),
            new PublicKey(dep.buyer),
            new PublicKey(SELLER_WALLET),
            new PublicKey(dep.reference),
            order.priceSol,
          )
          if (!funded) { await ctx.reply(mention, `ERROR: escrow not funded for reference=${dep.reference}`); continue }
          awarded.delete(dep.reference) // one delivery per order
          if (trace) console.error(`[${NAME}] escrow funded → delivering round ${dep.round}`)
          const result = await deliverService(`${order.service} ${order.arg}`.trim())
          await ctx.reply(mention, `DELIVERED round=${dep.round} ${result}`)
        } catch (e) {
          await ctx.reply(mention, `ERROR: settlement failed — ${(e as Error).message}`)
        }
        continue
      }

      // ── Legacy 1:1 direct-transfer protocol (on-ramp) ──────────────────────
      if (text.toLowerCase().startsWith('request')) {
        const query = text.replace(/^request\s*/i, '').trim() || 'default'
        const { url, reference, amountSol } = generatePaymentUrl(query)
        pending.set(reference, { request: query })
        await ctx.reply(mention, `PAYMENT_REQUIRED reference=${reference} amount=${amountSol} url=${url}`)
        continue
      }
      if (text.toLowerCase().startsWith('paid')) {
        const sig = text.match(/paid\s+(\S+)/i)?.[1]
        const reference = text.match(/reference=(\S+)/i)?.[1]
        if (!sig || !reference) { await ctx.reply(mention, 'ERROR: expected: paid <sig> reference=<reference>'); continue }
        const entry = pending.get(reference)
        if (!entry) { await ctx.reply(mention, `ERROR: unknown reference ${reference}`); continue }
        if (replay.has(sig)) { await ctx.reply(mention, 'ERROR: payment signature already used'); continue }
        if (!(await verifyPayment(sig, reference))) {
          await ctx.reply(mention, `ERROR: payment not confirmed for reference=${reference}`); continue
        }
        replay.consume(sig)
        pending.delete(reference)
        try {
          await ctx.reply(mention, `DELIVERED ${await deliverService(entry.request)}`)
        } catch (e) {
          await ctx.reply(mention, `ERROR: service delivery failed — ${(e as Error).message}`)
        }
        continue
      }
    } catch (e) {
      console.error(`[${NAME}] loop error: ${e}`)
    }
  }
})
