import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { assertDevnet } from '@pay/agent-runtime'
import type { ReviewResult } from '../agent/review.js'
import {
  ARBITER_PROGRAM_ID,
  arbitrateRefund,
  arbitrateRelease,
  arbitratedEscrowPda,
  configPda,
  initConfig,
  makeArbiter,
  open as arbiterOpen,
  vaultPda,
} from '../agent/arbiter.js'
import {
  ARBITER_TOP_UP_SOL,
  ARBITER_TOP_UP_THRESHOLD_SOL,
  assertCanRelease,
  assertCanRefund,
  buildFundingQuote,
  markFunded,
  markRefunded,
  markReleased,
  type Job,
} from './state.js'
import { HttpError } from './http.js'
import { ESCROW_ACCOUNT_SPACE, RPC, explorerLink } from './runtime.js'
import { arbiterKeypair, employerKeypair, keypairFromEnv, walletSnapshot, workerPublicKey } from './wallets.js'

export { ARBITER_PROGRAM_ID }

export const arbiterMismatchMessage = (expected: string, configured: string): string =>
  `ARBITER_KEYPAIR_B58 (${expected}) does not match the on-chain arbiter config (${configured}); use the configured arbiter keypair or deploy a fresh arbiter program.`

export async function configuredArbiterAddress(): Promise<string | null> {
  const signer = keypairFromEnv('BUYER_KEYPAIR_B58') ?? keypairFromEnv('ARBITER_KEYPAIR_B58') ?? Keypair.generate()
  try {
    const config = await (makeArbiter(signer, RPC).account as any).config.fetch(configPda())
    return new PublicKey(config.arbiter).toBase58()
  } catch {
    return null
  }
}

export async function health(): Promise<unknown> {
  const wallets = walletSnapshot()
  const walletsConfigured = {
    employer: Boolean(wallets.addresses.employer),
    worker: Boolean(wallets.addresses.worker),
    arbiter: Boolean(wallets.addresses.arbiter),
  }
  let ok = Object.values(walletsConfigured).every(Boolean)
  let devnet = true
  try {
    assertDevnet(RPC)
  } catch (e) {
    ok = false
    devnet = false
    wallets.errors.rpc = (e as Error).message
  }
  if (devnet && wallets.addresses.arbiter) {
    const configured = await configuredArbiterAddress()
    if (configured && configured !== wallets.addresses.arbiter) {
      ok = false
      wallets.errors.arbiterConfig = arbiterMismatchMessage(wallets.addresses.arbiter, configured)
    }
  }
  return {
    ok,
    status: ok ? 'ready' : 'needs_setup',
    version: '0.1.0',
    network: 'devnet',
    devnet,
    rpcUrl: RPC,
    walletsConfigured,
    wallets,
    timestamp: new Date().toISOString(),
  }
}

async function ensureArbiterConfig(admin: Keypair, arbiter: PublicKey): Promise<void> {
  const program = makeArbiter(admin, RPC)
  let config: any
  try {
    config = await (program.account as any).config.fetch(configPda())
  } catch {
    await initConfig(program, admin, arbiter)
    return
  }
  const configured = new PublicKey(config.arbiter)
  if (!configured.equals(arbiter)) {
    throw new Error(arbiterMismatchMessage(arbiter.toBase58(), configured.toBase58()))
  }
}

async function ensureArbiterFunded(payer: Keypair, arbiter: PublicKey): Promise<void> {
  assertDevnet(RPC)
  const connection = new Connection(RPC, 'confirmed')
  if ((await connection.getBalance(arbiter)) >= ARBITER_TOP_UP_THRESHOLD_SOL * LAMPORTS_PER_SOL) return
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: payer.publicKey,
    toPubkey: arbiter,
    lamports: Math.round(ARBITER_TOP_UP_SOL * LAMPORTS_PER_SOL),
  }))
  await sendAndConfirmTransaction(connection, tx, [payer])
}

export async function quoteFunding(amountSol: number) {
  assertDevnet(RPC)
  const connection = new Connection(RPC, 'confirmed')
  const rentLamports = await connection.getMinimumBalanceForRentExemption(ESCROW_ACCOUNT_SPACE)
  let arbiterBalanceSol: number | null = null
  try {
    arbiterBalanceSol = (await connection.getBalance(arbiterKeypair().publicKey)) / LAMPORTS_PER_SOL
  } catch {
    arbiterBalanceSol = null
  }
  return buildFundingQuote(Math.max(0.001, Number(amountSol) || 0.001), rentLamports / LAMPORTS_PER_SOL, arbiterBalanceSol)
}

export async function openEscrow(job: Job): Promise<void> {
  const employer = employerKeypair()
  const worker = workerPublicKey()
  const arbiter = arbiterKeypair()
  const reference = new PublicKey(job.reference)

  assertDevnet(RPC)
  await ensureArbiterConfig(employer, arbiter.publicKey)
  await ensureArbiterFunded(employer, arbiter.publicKey)

  const openSig = await arbiterOpen(makeArbiter(employer, RPC), employer, worker, reference, job.amountSol, job.deadlineSecs)
  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference)
  markFunded(job, {
    employer: employer.publicKey.toBase58(),
    worker: worker.toBase58(),
    arbiter: arbiter.publicKey.toBase58(),
    vault: vault.toBase58(),
    escrow: escrow.toBase58(),
    open: { sig: openSig, explorer: explorerLink('tx', openSig) },
  })
}

export async function releaseEscrow(job: Job, review: ReviewResult): Promise<void> {
  assertCanRelease(job)
  const arbiter = arbiterKeypair()
  const worker = workerPublicKey()
  const reference = new PublicKey(job.reference)
  const releaseSig = await arbitrateRelease(makeArbiter(arbiter, RPC), arbiter, worker, reference)
  markReleased(job, { sig: releaseSig, explorer: explorerLink('tx', releaseSig) }, review)
  job.settlement = {
    ...job.settlement,
    worker: worker.toBase58(),
    arbiter: arbiter.publicKey.toBase58(),
    release: { sig: releaseSig, explorer: explorerLink('tx', releaseSig) },
    error: undefined,
  }
}

export async function refundEscrow(job: Job): Promise<void> {
  try {
    assertCanRefund(job)
  } catch (e) {
    throw new HttpError(409, (e as Error).message)
  }

  const arbiter = arbiterKeypair()
  const employer = employerKeypair()
  const reference = new PublicKey(job.reference)
  const refundSig = await arbitrateRefund(makeArbiter(arbiter, RPC), arbiter, employer.publicKey, reference)
  markRefunded(job, { sig: refundSig, explorer: explorerLink('tx', refundSig) }, {
    employer: employer.publicKey.toBase58(),
    arbiter: arbiter.publicKey.toBase58(),
  })
}

async function balance(connection: Connection, address?: string | null): Promise<number | null> {
  if (!address) return null
  try {
    return Number(((await connection.getBalance(new PublicKey(address))) / LAMPORTS_PER_SOL).toFixed(6))
  } catch {
    return null
  }
}

export async function balancesFor(addresses: Record<string, string | null>): Promise<Record<string, number | null>> {
  assertDevnet(RPC)
  const connection = new Connection(RPC, 'confirmed')
  return Object.fromEntries(await Promise.all(
    Object.entries(addresses).map(async ([name, address]) => [name, await balance(connection, address)]),
  ))
}
