/**
 * Escrow settlement — BUYER side (signs deposit / release / refund).
 *
 * The buyer locks funds in a per-order escrow PDA, releases on delivery, or refunds after the
 * deadline. The `reference` is the same key the seller issues — it seeds the PDA. IDL is fetched
 * from the deployed program.
 *
 * TYPECHECK-ONLY: the on-chain calls require a deployed program + a funded devnet wallet to run.
 */
// @coral-xyz/anchor is CommonJS. Under Node ESM, a NAMESPACE import (`import * as`) only exposes the
// names cjs-module-lexer detects (BN is missed → "BN is not a constructor"). A DEFAULT import gives
// the whole module.exports, so every member resolves. (esModuleInterop makes this typecheck.)
import anchor from '@coral-xyz/anchor'
import type { Program } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
const { AnchorProvider, BN } = anchor

export const PROGRAM_ID = new PublicKey('R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet')

export function escrowPda(buyer: PublicKey, reference: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), reference.toBuffer()],
    PROGRAM_ID,
  )[0]
}

/** Program handle signed by the buyer (deposits/releases/refunds). */
export async function makeProgram(buyer: Keypair, rpcUrl: string): Promise<Program> {
  const provider = new AnchorProvider(
    new Connection(rpcUrl, 'confirmed'),
    new anchor.Wallet(buyer),
    { commitment: 'confirmed' },
  )
  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
  if (!idl) throw new Error('escrow IDL not found on-chain — is the program deployed to this cluster?')
  return new anchor.Program(idl, provider)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Lock `amountSol` for `reference`, refundable `deadlineSecs` from now. Returns the deposit sig. */
export async function deposit(
  program: Program,
  buyer: Keypair,
  seller: PublicKey,
  reference: PublicKey,
  amountSol: number,
  deadlineSecs: number,
): Promise<string> {
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecs)
  return (program.methods as any)
    .initialize(new BN(Math.round(amountSol * LAMPORTS_PER_SOL)), reference, deadline)
    .accounts({ buyer: buyer.publicKey, seller, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer])
    .rpc()
}

/** Confirm delivery → pay the seller and close the escrow. */
export async function release(
  program: Program,
  buyer: Keypair,
  seller: PublicKey,
  reference: PublicKey,
): Promise<string> {
  return (program.methods as any)
    .release()
    .accounts({ buyer: buyer.publicKey, seller, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer])
    .rpc()
}

/** Reclaim the deposit after the deadline (seller never delivered). */
export async function refund(program: Program, buyer: Keypair, reference: PublicKey): Promise<string> {
  return (program.methods as any)
    .refund()
    .accounts({ buyer: buyer.publicKey, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer])
    .rpc()
}
