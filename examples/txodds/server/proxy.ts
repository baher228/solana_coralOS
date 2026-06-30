/**
 * Real-data proxy for the World Cup Oracle React app.
 *
 * The browser cannot hold the TxLINE API token or sign Solana transactions, so this tiny Node server
 * does it: on first request it subscribes the kit's buyer wallet to the free World Cup tier on devnet,
 * activates an API token, then serves live fixtures/odds to the React app (which only ever talks here).
 *
 * Verified working against devnet (2026-06). Two corrections vs. the published TxODDS examples:
 *   1. host is `txline-dev.txodds.com`           (the repo's `oracle-dev.txodds.com` does not resolve)
 *   2. mint is the treasury's `4Zao8o…`          (the IDL's `TXLINE_MINT` constant is stale -> InvalidMint)
 *
 * Run:  ANCHOR off — just `npx ts-node server/proxy.ts`  (reads BUYER_KEYPAIR_B58 from the repo .env)
 */
import http from 'node:http'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import axios from 'axios'
import * as anchor from '@coral-xyz/anchor'
import {
  PublicKey, SystemProgram, Keypair, Connection, Transaction, sendAndConfirmTransaction, LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { fileURLToPath } from 'node:url'
import { assertDevnet } from '@pay/agent-runtime'
import { analyzeEdge, fairLine } from '../agent/edge.js'
import {
  makeArbiter, initConfig, open as arbiterOpen, arbitrateRelease,
  configPda, vaultPda, arbitratedEscrowPda, ARBITER_PROGRAM_ID,
} from '../agent/arbiter.js'
import { makeProgram, deposit, release, escrowPda } from '../agent/escrow.js'

// fileURLToPath (not .pathname) so the repo-root .env resolves on macOS/Linux too, not just Windows.
const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))

// Load the repo .env into process.env FIRST — before the constants below — so .env can override the
// program/mint/host, not just keys. A shell env var still wins (we only fill what's undefined). This is
// the single .env read; everything else reads process.env.
;(function loadEnv() {
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on the shell env */ }
})()

// TxLINE devnet ids — overridable via .env (TXLINE_PROGRAM / TXLINE_MINT) so a TxODDS rotation is a
// config change, not a code edit. Defaults are the values verified working on devnet (2026-06).
const PROGRAM = new PublicKey(process.env.TXLINE_PROGRAM ?? '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J')
const MINT = new PublicKey(process.env.TXLINE_MINT ?? '4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG') // treasury mint
const BASE = process.env.TXLINE_BASE_URL ?? 'https://txline-dev.txodds.com'
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const PORT = Number(process.env.PORT ?? 8801)

const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

function buyerKeypair(): Keypair {
  const b58 = process.env.BUYER_KEYPAIR_B58 // loaded from .env above (or the shell)
  if (!b58) throw new Error(`BUYER_KEYPAIR_B58 not set (looked in ${ENV_PATH})`)
  return Keypair.fromSecretKey(bs58.decode(b58.trim()))
}

/** The neutral arbiter signer (set by setup.js). Present → the demo settles through the arbiter wrapper. */
function arbiterKeypair(): Keypair | null {
  const b58 = process.env.ARBITER_KEYPAIR_B58
  return b58 ? Keypair.fromSecretKey(bs58.decode(b58.trim())) : null
}

let jwt = ''
let apiToken = ''

/** Subscribe (free tier) + activate, once. Caches the resulting API token. */
async function ensureToken(): Promise<void> {
  if (apiToken) return
  const keypair = buyerKeypair()
  assertDevnet(RPC) // devnet-only: refuse a mainnet RPC unless ALLOW_MAINNET=1
  const connection = new Connection(RPC, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' })
  const idl = (await anchor.Program.fetchIdl(PROGRAM, provider)) as anchor.Idl
  const program = new anchor.Program(idl, provider)

  jwt = (await axios.post(`${BASE}/auth/guest/start`)).data.token
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, keypair, MINT, keypair.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  )
  const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], PROGRAM)
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], PROGRAM)
  const tokenTreasuryVault = getAssociatedTokenAddressSync(MINT, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID)

  const txSig = await (program.methods as any)
    .subscribe(1, 4) // service level 1 (free World Cup), 4 weeks
    .accounts({
      user: keypair.publicKey, pricingMatrix, tokenMint: MINT, userTokenAccount: ata.address,
      tokenTreasuryVault, tokenTreasuryPda, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc()

  const msg = new TextEncoder().encode(`${txSig}::${jwt}`)
  const walletSignature = Buffer.from(nacl.sign.detached(msg, keypair.secretKey)).toString('base64')
  const data = (await axios.post(
    `${BASE}/api/token/activate`,
    { txSig, walletSignature, leagues: [] },
    { headers: { Authorization: `Bearer ${jwt}` } },
  )).data
  apiToken = data.token || data
  if (typeof apiToken !== 'string' || !apiToken) throw new Error('activation returned no token')
  console.error('[proxy] subscribed + activated — serving live TxODDS data')
}

async function txGet(path: string): Promise<unknown> {
  await ensureToken()
  const res = await axios.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  })
  return res.data
}

// A market is real if it has at least one finite price (the live feed is full of rows priced "NA" we
// must NOT surface). A fixture is board-worthy if it has ANY such market — the free World Cup tier's
// 1X2 odds are intermittent, but over/under + Asian-handicap markets are usually present, and those
// are verified de-margined odds too. 1X2 fixtures are still preferred (sorted first) when available.
const hasFinitePrice = (m: any): boolean =>
  Array.isArray(m?.PriceNames) &&
  m.PriceNames.some((_: unknown, i: number) => Number.isFinite(Number((m.Pct || [])[i])))
const has1x2 = (odds: any[]): boolean =>
  odds.some((m) => String(m?.SuperOddsType ?? '').includes('1X2') && hasFinitePrice(m))

/**
 * The fixtures to actually show: those with any verified live market, odds inlined so the UI never has
 * to guess or fall back to demo numbers for a live game. 1X2 fixtures sort first. Cached briefly +
 * fetched with bounded concurrency so the board loads fast without hammering the upstream.
 */
// Cache holds the last NON-EMPTY board. We never cache an empty scan (the free tier flickers in and
// out of having priced markets); instead, when a scan comes back empty we keep serving the last good
// board for a few minutes so the UI stays live through the gaps.
let boardCache: { at: number; data: any[] } = { at: 0, data: [] }
async function board(): Promise<any[]> {
  if (boardCache.data.length && Date.now() - boardCache.at < 30_000) return boardCache.data // fresh + good
  const fixtures = await txGet('/api/fixtures/snapshot')
  const list = ((Array.isArray(fixtures) ? fixtures : []) as any[]).slice(0, 80)
  const results: (any | null)[] = new Array(list.length).fill(null)
  let next = 0
  async function worker(): Promise<void> {
    while (next < list.length) {
      const idx = next++
      const f = list[idx]
      try {
        const odds = await txGet(`/api/odds/snapshot/${f.FixtureId}`)
        if (Array.isArray(odds) && (odds as any[]).some(hasFinitePrice)) results[idx] = { ...f, odds }
      } catch { /* skip this fixture on an upstream error */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))
  const data = (results.filter(Boolean) as any[])
    .sort((a, b) => Number(has1x2(b.odds)) - Number(has1x2(a.odds))) // 1X2 fixtures first
  if (data.length) { boardCache = { at: Date.now(), data }; return data } // got a live board — cache it
  if (boardCache.data.length && Date.now() - boardCache.at < 300_000) return boardCache.data // flicker — keep last good
  return data // genuinely nothing priced right now
}

/** The verified fair favourite for a board fixture (deterministic — no LLM), for the order commitment. */
function favouriteOf(fx: any): { label: string; pct: number; fairOdds: number } | undefined {
  const odds = (fx?.odds ?? []) as any[]
  const m = odds.find((x) => String(x?.SuperOddsType ?? '').includes('1X2') && hasFinitePrice(x)) ?? odds.find(hasFinitePrice)
  if (!m) return undefined
  const { favourite } = fairLine({ names: m.PriceNames, pct: m.Pct }, { home: fx.Participant1, away: fx.Participant2 })
  return favourite ? { label: favourite.label, pct: favourite.pct, fairOdds: favourite.fairOdds } : undefined
}

/**
 * The escrow `reference` BOUND to the order: `sha256("txodds:<fixtureId>:<favourite>@<fairOdds>:<nonce>")`.
 * A reference is just a 32-byte PDA seed (need not be on-curve), so the digest is the PublicKey directly.
 * The on-chain PDA then provably corresponds to exactly the read bought — anyone with `order.preimage`
 * can recompute it. The nonce keeps each settle's PDA unique. Shared by the direct + arbiter flows.
 */
async function boundReference(fixtureId: string): Promise<{ reference: PublicKey; order: any }> {
  const fx = (await board()).find((f) => String(f.FixtureId) === fixtureId)
  const fav = fx ? favouriteOf(fx) : undefined
  const nonce = Date.now()
  const preimage = fav
    ? `txodds:${fixtureId}:${fav.label}@${fav.fairOdds}:${nonce}`
    : `txodds:${fixtureId || 'unknown'}:${nonce}`
  const reference = new PublicKey(createHash('sha256').update(preimage).digest())
  return {
    reference,
    order: { fixtureId, matchup: fx ? `${fx.Participant1} v ${fx.Participant2}` : undefined, favourite: fav?.label, fairOdds: fav?.fairOdds, nonce, preimage },
  }
}

/**
 * Run a real devnet escrow deposit→release so the demo can link the settlement on-chain. The escrow
 * `reference` is BOUND to the order: it's `sha256("txodds:<fixtureId>:<favourite>@<fairOdds>:<nonce>")`,
 * so the on-chain PDA provably corresponds to exactly the read that was bought (anyone with the returned
 * `order.preimage` can recompute it). The nonce keeps each settle's PDA unique. The seller is a distinct
 * party (`SELLER_WALLET`/`WALLET`); if unset it self-pays (`selfPay:true`). Returns {ok:false,error} on
 * any failure so the UI can fall back gracefully.
 */
async function settle(amountSol: number, fixtureId: string): Promise<unknown> {
  try {
    const buyer = buyerKeypair()
    const sellerEnv = process.env.SELLER_WALLET || process.env.WALLET
    const seller = new PublicKey(sellerEnv || buyer.publicKey.toBase58())
    const selfPay = seller.equals(buyer.publicKey)
    // floor at the rent-exempt minimum (~0.00089 SOL) so paying a brand-new seller in one release
    // leaves it rent-exempt; below that the release is rejected ("insufficient funds for rent").
    const amount = Math.max(0.001, Number.isFinite(amountSol) ? amountSol : 0.001)
    const { reference, order } = await boundReference(fixtureId)

    const program = await makeProgram(buyer, RPC)
    const depositSig = await deposit(program, buyer, seller, reference, amount, 600)
    const releaseSig = await release(program, buyer, seller, reference)
    const pda = escrowPda(buyer.publicKey, reference).toBase58()
    return {
      ok: true, mode: 'direct', amountSol: amount, reference: reference.toBase58(),
      buyer: buyer.publicKey.toBase58(), seller: seller.toBase58(), selfPay, order,
      deposit: { sig: depositSig, explorer: expl('tx', depositSig) },
      release: { sig: releaseSig, explorer: expl('tx', releaseSig) },
      escrow: { pda, explorer: expl('address', pda) },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Configure the arbiter program once (idempotent): set who the neutral arbiter is. Admin = the payer. */
async function ensureArbiterConfig(admin: Keypair, arbiter: PublicKey): Promise<void> {
  const program = makeArbiter(admin, RPC)
  try {
    await (program.account as any).config.fetch(configPda())
    return // already configured
  } catch { /* not yet — set it below */ }
  await initConfig(program, admin, arbiter)
}

/** Keep the arbiter funded for tx fees by topping up from the payer when low — so a fresh checkout
 * (setup.js generates an unfunded arbiter keypair) settles out of the box. */
async function ensureArbiterFunded(payer: Keypair, arbiter: PublicKey): Promise<void> {
  const connection = new Connection(RPC, 'confirmed')
  if ((await connection.getBalance(arbiter)) >= 0.01 * LAMPORTS_PER_SOL) return
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey, toPubkey: arbiter, lamports: Math.round(0.02 * LAMPORTS_PER_SOL),
  }))
  await sendAndConfirmTransaction(connection, tx, [payer])
}

/**
 * The trustless 3-party settlement (the arbiter wrapper). The buyer (payer) `open`s an order — funds a
 * vault PDA that becomes the escrow's buyer, so the buyer can NO LONGER unilaterally release/refund.
 * Then the neutral **arbiter** attests delivery and releases to the seller. The seller is protected.
 * Same order-bound `reference` as the direct path. Throws on failure so the route can fall back.
 */
async function settleViaArbiter(amountSol: number, fixtureId: string): Promise<unknown> {
  const buyer = buyerKeypair()
  const arbiter = arbiterKeypair()
  if (!arbiter) throw new Error('no ARBITER_KEYPAIR_B58 configured')
  const sellerEnv = process.env.SELLER_WALLET || process.env.WALLET
  const seller = new PublicKey(sellerEnv || buyer.publicKey.toBase58())
  const selfPay = seller.equals(buyer.publicKey)
  const amount = Math.max(0.001, Number.isFinite(amountSol) ? amountSol : 0.001)
  const { reference, order } = await boundReference(fixtureId)

  await ensureArbiterConfig(buyer, arbiter.publicKey)
  await ensureArbiterFunded(buyer, arbiter.publicKey)
  // 1) buyer opens the arbitrated order (funds the vault → escrow, vault = buyer)
  const openSig = await arbiterOpen(makeArbiter(buyer, RPC), buyer, seller, reference, amount, 600)
  // 2) the neutral arbiter attests delivery → releases to the seller
  const releaseSig = await arbitrateRelease(makeArbiter(arbiter, RPC), arbiter, seller, reference)

  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference).toBase58()
  return {
    ok: true, mode: 'arbiter', amountSol: amount, reference: reference.toBase58(),
    buyer: buyer.publicKey.toBase58(), seller: seller.toBase58(),
    arbiter: arbiter.publicKey.toBase58(), vault: vault.toBase58(), selfPay, order,
    open: { sig: openSig, explorer: expl('tx', openSig) },
    release: { sig: releaseSig, explorer: expl('tx', releaseSig) },
    escrow: { pda: escrow, explorer: expl('address', escrow) },
  }
}

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
      if (url.pathname === '/api/board') {
        // only fixtures with verified live 1X2 odds (odds inlined) — what the dashboard renders
        res.end(JSON.stringify(await board()))
      } else if (url.pathname === '/api/fixtures') {
        res.end(JSON.stringify(await txGet('/api/fixtures/snapshot')))
      } else if (url.pathname === '/api/odds') {
        res.end(JSON.stringify(await txGet(`/api/odds/snapshot/${url.searchParams.get('fixtureId') ?? ''}`)))
      } else if (url.pathname === '/api/edge') {
        // verified data (TxLINE) → LLM call: the on-thesis product, shared with the agent via analyzeEdge.
        const fixtureId = url.searchParams.get('fixtureId') ?? ''
        const [live, fixtures] = await Promise.all([
          txGet(`/api/odds/snapshot/${fixtureId}`).catch(() => []),
          txGet('/api/fixtures/snapshot'),
        ])
        // the free feed flickers to empty between calls — fall back to the odds the board already
        // verified for this fixture, so the call never sees "no data" for a fixture the board shows.
        let odds = live
        if (!(Array.isArray(odds) && (odds as any[]).some(hasFinitePrice))) {
          const fromBoard = (await board()).find((f) => String(f.FixtureId) === fixtureId)
          if (fromBoard) odds = fromBoard.odds
        }
        res.end(JSON.stringify(await analyzeEdge({ fixtureId, odds, fixtures })))
      } else if (url.pathname === '/api/settle') {
        // settle on devnet with the reference bound to the order. Prefer the trustless arbiter wrapper
        // (3 parties, seller-protected); fall back to the direct buyer-released escrow if it errors.
        const amount = Number(url.searchParams.get('amount') ?? '0.001')
        const fixtureId = url.searchParams.get('fixtureId') ?? ''
        let result: any
        if (arbiterKeypair()) {
          try { result = await settleViaArbiter(amount, fixtureId) }
          catch (e) { result = await settle(amount, fixtureId); result.arbiterError = (e as Error).message }
        } else {
          result = await settle(amount, fixtureId)
        }
        res.end(JSON.stringify(result))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found' }))
      }
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: (e as Error).message, detail: (e as any)?.response?.data }))
    }
  })
  .listen(PORT, () => console.error(`[proxy] http://localhost:${PORT}  (GET /api/board · /api/fixtures · /api/odds?fixtureId= · /api/edge?fixtureId= · /api/settle?amount=)`))
