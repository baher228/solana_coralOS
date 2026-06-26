import { LAMPORTS_PER_SOL } from '@solana/web3.js'

/** Per-purchase, code-enforced trust state: which recipients/references are payable, and total spent. */
export interface PurchaseGuard {
  /** Recipients the buyer actually saw in a real 402 challenge — the only ones it may pay. */
  allowedRecipients: Set<string>
  /** References the buyer saw in a real challenge. */
  allowedReferences: Set<string>
  /** Cumulative spend across the whole loop, capped at the budget. */
  spentLamports: number
}

export interface PaymentInput {
  recipient: string
  amountSol: number
  reference?: string
}

export type GuardResult = { allowed: true; lamports: number } | { allowed: false; reason: string }

/**
 * The buyer's payment rules, **enforced in code, not in the prompt**. A prompt injection in fetched
 * data cannot bypass these:
 *   - H2: the recipient (and reference) must have appeared in a real 402 challenge.
 *   - M3: cumulative spend across the loop must stay within the budget.
 *
 * Returns whether the payment is allowed; the caller only sends on `{ allowed: true }`.
 */
export function guardPayment(guard: PurchaseGuard, input: PaymentInput, budgetLamports: number): GuardResult {
  const lamports = Math.round(input.amountSol * LAMPORTS_PER_SOL)

  if (!guard.allowedRecipients.has(input.recipient)) {
    return { allowed: false, reason: `recipient ${input.recipient} did not appear in any payment challenge` }
  }
  if (input.reference && !guard.allowedReferences.has(input.reference)) {
    return { allowed: false, reason: `reference ${input.reference} did not appear in any payment challenge` }
  }
  if (guard.spentLamports + lamports > budgetLamports) {
    const want = (guard.spentLamports + lamports) / LAMPORTS_PER_SOL
    return { allowed: false, reason: `budget exceeded: cumulative ${want} SOL > ${budgetLamports / LAMPORTS_PER_SOL} SOL` }
  }
  return { allowed: true, lamports }
}
