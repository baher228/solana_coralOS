/**
 * Arbiter client — the trustless wrapper over the escrow (see ../escrow/programs/arbiter).
 *
 * The 3-party settlement the demo runs:
 *   1. `open(payer, seller, reference, amount, deadline)` — the payer funds a vault PDA (derived from
 *      the order `reference`) and CPIs escrow.initialize with the vault as the escrow's buyer. The payer
 *      now has NO on-chain power over the funds.
 *   2. `arbitrateRelease(arbiter, seller, reference)` — the neutral arbiter attests delivery → the
 *      escrow pays the seller. Only the configured arbiter can call this (so the buyer can't take
 *      delivery and refund — the seller is protected).
 *   3. `arbitrateRefund(arbiter, payer, reference)` — after the deadline, the arbiter refunds → funds
 *      are swept back to the payer.
 *
 * The arbiter program id is fixed (deployed to devnet); its IDL is bundled (./arbiter_idl.json) so no
 * on-chain IDL upload is needed. Connections go through the devnet guard.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import anchor from '@coral-xyz/anchor'
import type { Program } from '@coral-xyz/anchor'
import { Keypair, PublicKey, LAMPORTS_PER_SOL, SystemProgram } from '@solana/web3.js'
import { solanaConnection } from '@pay/agent-runtime'
import { PROGRAM_ID as ESCROW_PROGRAM_ID } from './escrow.js'

const { AnchorProvider, BN } = anchor

export const ARBITER_PROGRAM_ID = new PublicKey('FJtuVXsyXuRKqgJBEPAXmktkd13CqStapgevzGwYktXd')

const ARBITER_IDL = JSON.parse(readFileSync(fileURLToPath(new URL('./arbiter_idl.json', import.meta.url)), 'utf8'))

export const configPda = (): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from('config')], ARBITER_PROGRAM_ID)[0]
export const vaultPda = (reference: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from('vault'), reference.toBuffer()], ARBITER_PROGRAM_ID)[0]
/** The escrow PDA for an arbitrated order — seeded by the VAULT (its buyer), not the human payer. */
export const arbitratedEscrowPda = (vault: PublicKey, reference: PublicKey): PublicKey =>
  PublicKey.findProgramAddressSync([Buffer.from('escrow'), vault.toBuffer(), reference.toBuffer()], ESCROW_PROGRAM_ID)[0]

/** Program handle. `signer` is the provider wallet that pays fees (the payer for open, the arbiter for arbitrate). */
export function makeArbiter(signer: Keypair, rpcUrl: string): Program {
  const provider = new AnchorProvider(solanaConnection(rpcUrl), new anchor.Wallet(signer), { commitment: 'confirmed' })
  return new anchor.Program(ARBITER_IDL as anchor.Idl, provider)
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function initConfig(program: Program, admin: Keypair, arbiter: PublicKey): Promise<string> {
  return (program.methods as any)
    .initConfig(arbiter)
    .accounts({ admin: admin.publicKey, config: configPda(), systemProgram: SystemProgram.programId })
    .signers([admin]).rpc()
}

export async function open(
  program: Program, payer: Keypair, seller: PublicKey, reference: PublicKey, amountSol: number, deadlineSecs: number,
): Promise<string> {
  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference)
  const deadline = new BN(Math.floor(Date.now() / 1000) + deadlineSecs)
  return (program.methods as any)
    .open(new BN(Math.round(amountSol * LAMPORTS_PER_SOL)), reference, deadline)
    .accounts({
      payer: payer.publicKey, vault, seller, escrow,
      escrowProgram: ESCROW_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([payer]).rpc()
}

export async function arbitrateRelease(
  program: Program, arbiter: Keypair, seller: PublicKey, reference: PublicKey,
): Promise<string> {
  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference)
  return (program.methods as any)
    .arbitrateRelease(reference)
    .accounts({ arbiter: arbiter.publicKey, config: configPda(), vault, seller, escrow, escrowProgram: ESCROW_PROGRAM_ID })
    .signers([arbiter]).rpc()
}

export async function arbitrateRefund(
  program: Program, arbiter: Keypair, payer: PublicKey, reference: PublicKey,
): Promise<string> {
  const vault = vaultPda(reference)
  const escrow = arbitratedEscrowPda(vault, reference)
  return (program.methods as any)
    .arbitrateRefund(reference)
    .accounts({
      arbiter: arbiter.publicKey, config: configPda(), vault, payer, escrow,
      escrowProgram: ESCROW_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .signers([arbiter]).rpc()
}
