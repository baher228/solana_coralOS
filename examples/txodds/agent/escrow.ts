/**
 * Minimal buyer-side direct escrow client kept from the imported backbone for future live devnet
 * settlement wiring. The current UI uses local demo escrow state.
 */
import anchor from '@coral-xyz/anchor'
import type { Program } from '@coral-xyz/anchor'
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
const { AnchorProvider, BN } = anchor

export const PROGRAM_ID = new PublicKey('R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet')

function assertDevnet(rpcUrl: string) {
  if (process.env.ALLOW_MAINNET === '1') return
  if (/mainnet/i.test(rpcUrl)) throw new Error(`Refusing mainnet RPC "${rpcUrl}"`)
}

export function escrowPda(buyer: PublicKey, reference: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('escrow'), buyer.toBuffer(), reference.toBuffer()],
    PROGRAM_ID,
  )[0]
}

export async function makeProgram(buyer: Keypair, rpcUrl: string): Promise<Program> {
  assertDevnet(rpcUrl)
  const provider = new AnchorProvider(new Connection(rpcUrl, 'confirmed'), new anchor.Wallet(buyer), { commitment: 'confirmed' })
  const idl = await anchor.Program.fetchIdl(PROGRAM_ID, provider)
  if (!idl) throw new Error('escrow IDL not found on-chain')
  return new anchor.Program(idl, provider)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The backend acts as both buyer (funder) and arbiter (settlement authority) using a single
// platform key. A production deployment can pass a distinct `arbiter` to separate custody from
// settlement; the on-chain program supports it directly.
export async function deposit(
  program: Program, buyer: Keypair, seller: PublicKey, reference: PublicKey, amountSol: number, deadlineSecs: number,
  arbiter: PublicKey = buyer.publicKey,
): Promise<string> {
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecs)
  return (program.methods as any)
    .initialize(new BN(Math.round(amountSol * LAMPORTS_PER_SOL)), reference, deadline)
    .accounts({ buyer: buyer.publicKey, seller, arbiter, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer]).rpc()
}

// Settlement (release/refund) is authorized by the arbiter. `signer` is the arbiter keypair; in
// production this is where a KMS/HSM signer replaces an in-process keypair (see makeProgram).
export async function release(program: Program, signer: Keypair, buyer: PublicKey, seller: PublicKey, arbiter: PublicKey, reference: PublicKey): Promise<string> {
  return (program.methods as any)
    .release()
    .accounts({ buyer, seller, arbiter, escrow: escrowPda(buyer, reference) })
    .signers([signer]).rpc()
}

export async function refund(program: Program, signer: Keypair, buyer: PublicKey, arbiter: PublicKey, reference: PublicKey): Promise<string> {
  return (program.methods as any)
    .refund()
    .accounts({ buyer, arbiter, escrow: escrowPda(buyer, reference) })
    .signers([signer]).rpc()
}
