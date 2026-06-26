/**
 * Escrow settlement — SELLER side (read-only).
 *
 * The seller never signs on-chain; it only checks "is money locked for me?" before delivering
 * (release is the buyer's call). The IDL is fetched from the deployed program, so nothing needs
 * bundling. PROGRAM_ID matches the devnet deployment.
 *
 * TYPECHECK-ONLY: the on-chain calls require a deployed program + devnet RPC to actually run.
 */
// @coral-xyz/anchor is CommonJS — a DEFAULT import exposes the whole module.exports (a namespace
// import misses members the cjs lexer doesn't detect). esModuleInterop makes this typecheck.
import anchor from '@coral-xyz/anchor'
import type { Program } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
const { AnchorProvider } = anchor

export const PROGRAM_ID = new PublicKey('R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet')

/** Per-order escrow PDA: one per (buyer, reference). */
export function escrowPda(buyer: PublicKey, reference: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), reference.toBuffer()],
    PROGRAM_ID,
  )[0]
}

/** Read-only Program handle (a throwaway wallet — the seller never signs). */
export async function makeProgram(rpcUrl: string): Promise<Program> {
  const provider = new AnchorProvider(
    new Connection(rpcUrl, 'confirmed'),
    new anchor.Wallet(Keypair.generate()),
    { commitment: 'confirmed' },
  )
  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
  if (!idl) throw new Error('escrow IDL not found on-chain — is the program deployed to this cluster?')
  return new anchor.Program(idl, provider)
}

/** Is a funded escrow present for (buyer, reference) naming `seller`, holding ≥ `minAmountSol`? */
export async function isFunded(
  program: Program,
  buyer: PublicKey,
  seller: PublicKey,
  reference: PublicKey,
  minAmountSol = 0,
): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acct = await (program.account as any).escrow.fetchNullable(escrowPda(buyer, reference))
  if (!acct) return false
  return (
    acct.buyer.equals(buyer) &&
    acct.seller.equals(seller) &&
    acct.amount.toNumber() >= Math.round(minAmountSol * LAMPORTS_PER_SOL)
  )
}
