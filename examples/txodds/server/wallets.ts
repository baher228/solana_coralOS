import bs58 from 'bs58'
import { Keypair, PublicKey } from '@solana/web3.js'
import { ENV_PATH } from './runtime.js'

export interface WalletSnapshot {
  addresses: Record<string, string | null>
  errors: Record<string, string>
}

export function keypairFromEnv(name: string): Keypair | null {
  const b58 = process.env[name]
  if (!b58) return null
  return Keypair.fromSecretKey(bs58.decode(b58.trim()))
}

export function employerKeypair(): Keypair {
  const kp = keypairFromEnv('BUYER_KEYPAIR_B58')
  if (!kp) throw new Error(`BUYER_KEYPAIR_B58 not set (looked in ${ENV_PATH})`)
  return kp
}

export function arbiterKeypair(): Keypair {
  const kp = keypairFromEnv('ARBITER_KEYPAIR_B58')
  if (!kp) throw new Error(`ARBITER_KEYPAIR_B58 not set (looked in ${ENV_PATH})`)
  return kp
}

export function workerPublicKey(): PublicKey {
  const seller = keypairFromEnv('SELLER_KEYPAIR_B58')
  if (seller) return seller.publicKey
  if (process.env.WALLET) return new PublicKey(process.env.WALLET.trim())
  return employerKeypair().publicKey
}

export function walletSnapshot(): WalletSnapshot {
  const addresses: Record<string, string | null> = { employer: null, worker: null, arbiter: null }
  const errors: Record<string, string> = {}
  try { addresses.employer = employerKeypair().publicKey.toBase58() } catch (e) { errors.employer = (e as Error).message }
  try { addresses.worker = workerPublicKey().toBase58() } catch (e) { errors.worker = (e as Error).message }
  try { addresses.arbiter = arbiterKeypair().publicKey.toBase58() } catch (e) { errors.arbiter = (e as Error).message }
  return { addresses, errors }
}
