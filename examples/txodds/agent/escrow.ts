/**
 * Minimal buyer-side escrow client. The freelance demo settles through the arbiter wrapper, but this
 * direct client remains useful for contract-level experiments. Connections go through the devnet guard.
 *
 * Live RPC + a funded wallet required, so this is exercised in the running demo, not in `npm test`.
 */
import anchor from '@coral-xyz/anchor'
import type { Program } from '@coral-xyz/anchor'
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { solanaConnection } from '@pay/agent-runtime'
const { AnchorProvider, BN } = anchor

export const PROGRAM_ID = new PublicKey('R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet')

export function escrowPda(buyer: PublicKey, reference: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), reference.toBuffer()],
    PROGRAM_ID,
  )[0]
}

/** Program handle signed by the buyer; solanaConnection applies the devnet guard. */
export async function makeProgram(buyer: Keypair, rpcUrl: string): Promise<Program> {
  const provider = new AnchorProvider(solanaConnection(rpcUrl), new anchor.Wallet(buyer), { commitment: 'confirmed' })
  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
  if (!idl) throw new Error('escrow IDL not found on-chain — is the program deployed to this cluster?')
  return new anchor.Program(idl, provider)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function deposit(
  program: Program, buyer: Keypair, seller: PublicKey, reference: PublicKey, amountSol: number, deadlineSecs: number,
): Promise<string> {
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecs)
  return (program.methods as any)
    .initialize(new BN(Math.round(amountSol * LAMPORTS_PER_SOL)), reference, deadline)
    .accounts({ buyer: buyer.publicKey, seller, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer]).rpc()
}

export async function release(program: Program, buyer: Keypair, seller: PublicKey, reference: PublicKey): Promise<string> {
  return (program.methods as any)
    .release()
    .accounts({ buyer: buyer.publicKey, seller, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer]).rpc()
}
