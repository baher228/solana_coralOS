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

export async function refund(program: Program, buyer: Keypair, reference: PublicKey): Promise<string> {
  return (program.methods as any)
    .refund()
    .accounts({ buyer: buyer.publicKey, escrow: escrowPda(buyer.publicKey, reference) })
    .signers([buyer]).rpc()
}
