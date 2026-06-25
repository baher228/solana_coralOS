import { BaseStrategy, MutableAgentState, untilAborted } from '../strategy.js'
import { PublicKey } from '@solana/web3.js'
import { encodeURL } from '@solana/pay'
import BigNumber from 'bignumber.js'

/** Configuration for `TransferStrategy`. */
export interface TransferConfig {
  /** Default recipient public key (base58). Can be overridden per-message. */
  recipient: string
  /** Default transfer amount in SOL. Can be overridden per-message. */
  amountSol: number
  /** Optional label embedded in the Solana Pay URL (shown in wallets). */
  label?: string
  /** Optional memo embedded in the Solana Pay URL. */
  message?: string
}

/**
 * Generates Solana Pay transfer-request URLs (`solana:<recipient>?...`).
 *
 * On `start()`, immediately encodes the configured recipient/amount and logs the URL.
 * On `handleMessage()`, generates a URL from the incoming request, allowing the caller
 * to dynamically specify a different recipient and amount.
 *
 * Mirrors the Rust `TransferStrategy`.
 */
export class TransferStrategy extends BaseStrategy {
  readonly name = 'solana-pay-transfer'
  private config: TransferConfig

  constructor(config: TransferConfig) {
    super()
    this.config = config
  }

  /**
   * Generate a Solana Pay URL from an incoming message.
   *
   * Input formats accepted:
   * - JSON: `{"recipient":"<base58>","amount":0.01,"label":"..."}`
   * - Plain text: bare base58 public key (uses configured amount/label)
   *
   * @returns The `solana:` URL string, or an `"error: ..."` string on failure.
   */
  async handleMessage(text: string, state: MutableAgentState): Promise<string> {
    try {
      const req = JSON.parse(text) as { recipient?: string; amount?: number; label?: string }
      const recipient = req.recipient ?? text.trim()
      const amount = req.amount ?? this.config.amountSol
      const label = req.label ?? this.config.label
      const url = encodeURL({
        recipient: new PublicKey(recipient),
        amount: new BigNumber(amount),
        label,
        message: this.config.message,
      })
      const urlStr = url.toString()
      state.recordAction('coral-url-generated', urlStr)
      return urlStr
    } catch (e) {
      return `error: ${String(e)}`
    }
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    try {
      const url = encodeURL({
        recipient: new PublicKey(this.config.recipient),
        amount: new BigNumber(this.config.amountSol),
        label: this.config.label,
        message: this.config.message,
      })
      state.recordAction('url-generated', url.toString())
    } catch (e) {
      state.recordAction('url-error', String(e))
    }
    await untilAborted(signal)
  }
}
