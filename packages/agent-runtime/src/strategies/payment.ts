import { BaseStrategy, MutableAgentState, untilAborted } from '../strategy.js'
import type { PaymentChallenge } from '../types.js'

/** Configuration for `PaymentStrategy`. */
export interface PaymentConfig {
  /** HTTP endpoint to poll. Expected to return 402 with a payment challenge. */
  endpoint: string
  /** Maximum lamports the agent is authorised to spend per session. */
  budgetLamports: number
}

/**
 * Parse the `WWW-Authenticate` header of an HTTP 402 response.
 * Supports both `mpp=<base64>` and `x402=<base64>` challenge formats.
 * @returns Parsed `PaymentChallenge`, or `null` if the header is absent or malformed.
 */
function parse402Headers(headers: Headers): PaymentChallenge | null {
  const auth = headers.get('www-authenticate') ?? ''
  if (!auth) return null
  const mppMatch = auth.match(/mpp=([^\s,]+)/)
  const x402Match = auth.match(/x402=([^\s,]+)/)
  const val = mppMatch?.[1] ?? x402Match?.[1]
  if (!val) return null
  try {
    return JSON.parse(atob(val)) as PaymentChallenge
  } catch {
    return null
  }
}

/**
 * Polls an HTTP endpoint that requires micropayment (HTTP 402) and records the
 * payment challenge details. Breaks when the endpoint returns 200.
 *
 * This strategy detects and logs challenges — actual wallet signing is done by the
 * buyer-agent layer (see `coral-agents/buyer-agent/src/wallet.ts`).
 */
export class PaymentStrategy extends BaseStrategy {
  readonly name = 'solana-pay-payment'
  private config: PaymentConfig

  constructor(config: PaymentConfig) {
    super()
    this.config = config
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const resp = await fetch(this.config.endpoint, { signal })
        if (resp.status === 402) {
          const challenge = parse402Headers(resp.headers)
          if (challenge) {
            state.recordAction('payment-challenge', JSON.stringify(challenge))
          }
        } else if (resp.ok) {
          const body = await resp.text()
          state.recordAction('payment-success', body.slice(0, 200))
          break
        }
      } catch (e) {
        if (!signal.aborted) state.recordAction('payment-error', String(e))
      }
      // Respect the abort signal during the inter-poll sleep.
      await Promise.race([new Promise(r => setTimeout(r, 10_000)), untilAborted(signal)])
    }
  }
}
