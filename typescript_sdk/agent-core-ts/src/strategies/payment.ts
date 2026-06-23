import type { Strategy, MutableAgentState } from '../strategy.js'
import { untilAborted } from '../strategy.js'
import type { PaymentChallenge } from '../types.js'

export interface PaymentConfig {
  endpoint: string
  budgetLamports: number
}

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

export class PaymentStrategy implements Strategy {
  readonly name = 'solana-pay-payment'
  private config: PaymentConfig

  constructor(config: PaymentConfig) {
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
      await new Promise(r => setTimeout(r, 10_000))
    }
  }
}
