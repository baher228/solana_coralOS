import { BaseStrategy, MutableAgentState, untilAborted } from '../strategy.js'
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'

/** Configuration for `HeliusMonitorStrategy`. */
export interface HeliusMonitorConfig {
  /** Base58-encoded recipient public key to watch. */
  recipient: string
  /** Minimum transfer amount in SOL required to qualify as a full payment. */
  amountSol: number
  /** Helius API key. Omit to fall back to the public devnet endpoint. */
  apiKey?: string
  /** Target network. Defaults to `"devnet"` when `apiKey` is omitted. */
  network?: 'devnet' | 'mainnet-beta'
}

/**
 * Watches a Solana wallet address for incoming SOL transfers using a WebSocket
 * `accountSubscribe` subscription (via `Connection.onAccountChange`).
 *
 * Fires `"payment-received"` when the balance increases by at least `amountSol`,
 * or `"partial-payment"` for smaller positive deltas.
 *
 * If a Helius `apiKey` is provided, traffic goes through the Helius enhanced RPC
 * (`helius-rpc.com`) instead of the public devnet endpoint.
 */
export class HeliusMonitorStrategy extends BaseStrategy {
  readonly name = 'helius-monitor'
  private config: HeliusMonitorConfig

  constructor(config: HeliusMonitorConfig) {
    super()
    this.config = config
  }

  /** Build the HTTPS RPC URL, preferring Helius if an API key is configured. */
  private rpcUrl(): string {
    if (this.config.apiKey) {
      const net = this.config.network === 'mainnet-beta' ? 'mainnet' : 'devnet'
      return `https://${net}.helius-rpc.com/?api-key=${this.config.apiKey}`
    }
    return 'https://api.devnet.solana.com'
  }

  /** Build the WebSocket URL that mirrors the RPC URL above. */
  private wsUrl(): string {
    if (this.config.apiKey) {
      const net = this.config.network === 'mainnet-beta' ? 'mainnet' : 'devnet'
      return `wss://${net}.helius-rpc.com/?api-key=${this.config.apiKey}`
    }
    return 'wss://api.devnet.solana.com'
  }

  async run(state: MutableAgentState, signal: AbortSignal): Promise<void> {
    const conn = new Connection(this.rpcUrl(), {
      commitment: 'confirmed',
      wsEndpoint: this.wsUrl(),
    })

    const pubkey = new PublicKey(this.config.recipient)
    const expectedLamports = Math.round(this.config.amountSol * LAMPORTS_PER_SOL)

    // Capture baseline balance so we can compute inbound deltas.
    let lastLamports = 0
    try {
      const info = await conn.getAccountInfo(pubkey)
      lastLamports = info?.lamports ?? 0
    } catch {
      state.recordAction('monitor-error', 'baseline balance fetch failed')
    }

    state.recordAction('monitoring', `watching ${this.config.recipient} for ${this.config.amountSol} SOL`)

    const subId = conn.onAccountChange(pubkey, (accountInfo) => {
      const current = accountInfo.lamports
      const diff = current - lastLamports
      if (diff > 0) {
        const amountSol = diff / LAMPORTS_PER_SOL
        const qualified = diff >= expectedLamports
        state.recordAction(
          qualified ? 'payment-received' : 'partial-payment',
          `received ${amountSol.toFixed(9)} SOL`
        )
      }
      lastLamports = current
    }, 'confirmed')

    await untilAborted(signal)

    conn.removeAccountChangeListener(subId)
  }
}
