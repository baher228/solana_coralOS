import { PublicKey, Keypair } from '@solana/web3.js'
import { encodeURL, validateTransfer } from '@solana/pay'
import BigNumber from 'bignumber.js'
import { solanaConnection } from '@pay/agent-runtime'

/** Lazy connection factory — fresh `Connection` per call, guarded against a mainnet RPC. */
const connection = () => solanaConnection()

/** Return value from `generatePaymentUrl`. */
export interface PaymentUrl {
  /** Full `solana:` URL encoding the transfer request (recipient, amount, reference). */
  url: string
  /**
   * Unique single-use **reference** public key (base58) that binds this payment to this order.
   * The buyer writes it into the transfer as a read-only account; the seller verifies the payment
   * carries it. This makes a payment proof non-transferable — a payment for one order can't satisfy
   * another, and a third party can't steal the signature.
   */
  reference: string
  /** Requested amount in SOL. */
  amountSol: number
}

/**
 * Generate a Solana Pay transfer URL for the given buyer `request` string, tagged with a unique
 * reference key.
 *
 * Requires:
 * - `SELLER_WALLET` — base58 public key of the seller's wallet.
 * - `PRICE_SOL`     — price in SOL (default `"0.0001"`).
 */
export function generatePaymentUrl(request: string): PaymentUrl {
  const recipient = process.env.SELLER_WALLET
  if (!recipient) throw new Error('SELLER_WALLET not set')

  const amountSol = parseFloat(process.env.PRICE_SOL ?? '0.0001')
  const reference = Keypair.generate().publicKey // unique per request — single-use binding

  const url = encodeURL({
    recipient: new PublicKey(recipient),
    amount: new BigNumber(amountSol),
    reference,
    label: 'Agent Service',
    message: request.slice(0, 100),
  })

  return { url: url.toString(), reference: reference.toBase58(), amountSol }
}

/**
 * Verify that `sig` is a confirmed transaction transferring `PRICE_SOL` to `SELLER_WALLET` **and
 * carrying `reference`**. Binding to the per-request reference is what makes the proof
 * non-transferable (see `PaymentUrl.reference`): unlike an amount+recipient check, a payment for one
 * order cannot be reused for another, and a stolen signature won't validate against a different
 * reference.
 *
 * Uses Solana Pay's `validateTransfer`, which checks recipient, amount, and reference together.
 *
 * @returns `true` if the payment is valid, `false` otherwise (including on RPC / validation errors).
 */
export async function verifyPayment(sig: string, reference: string): Promise<boolean> {
  try {
    const conn = connection()
    await validateTransfer(
      conn,
      sig,
      {
        recipient: new PublicKey(process.env.SELLER_WALLET!),
        amount: new BigNumber(parseFloat(process.env.PRICE_SOL ?? '0.0001')),
        reference: new PublicKey(reference),
      },
      { commitment: 'confirmed' },
    )
    return true
  } catch {
    return false
  }
}
